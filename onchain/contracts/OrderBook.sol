// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
Professional hybrid order book settlement contract

Key features
- Owner-managed token and pair allowlists
- Off-chain signed orders (EIP-712) with on-chain settlement
- Partial fills and per-order cancellations + cancelUpTo(minNonce) invalidation
- Fee collection in quote token (0.4% by default) from the side that transfers quote
- Pausable, reentrancy-safe, and event-rich

Fee model
- Fee is always denominated in the quote token at 0.4% by default (40 basis points)
- Fee is charged to the party that pays quote tokens in the trade
  * If maker is SELL (side=0), taker pays quote; taker pays fee in quote on top
  * If maker is BUY  (side=1), maker pays quote; maker pays fee in quote on top

Price and amount units
- amountBase is in base token units
- price is a fixed-point 18-decimal value representing quote per base
  quoteAmount = amountBase * price / 1e18

Notes
- This contract assumes standard ERC20 behavior (non fee-on-transfer). Such tokens are unsupported.
- Use SafeERC20, check approvals, and ensure users approve this contract to move their tokens.
- EIP-712 domain: name "OrderBook", version "1".
*/

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract OrderBook is EIP712, Pausable, ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constants and types
    // ---------------------------------------------------------------------

    uint256 public constant PRICE_DECIMALS = 1e18; // price scale: quote per base in 18-dec fixed
    uint16 public constant BPS_DENOMINATOR = 10_000; // basis points denominator

    // Side: 0 = SELL (maker sells base for quote), 1 = BUY (maker buys base paying quote)
    struct Order {
        address maker;
        address base;
        address quote;
        uint8 side;       // 0 SELL, 1 BUY
        uint256 amount;   // base token amount (max)
        uint256 price;    // quote per base, 18-dec fixed
        uint256 expiry;   // unix timestamp
        uint256 nonce;    // unique per maker
    }

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,address base,address quote,uint8 side,uint256 amount,uint256 price,uint256 expiry,uint256 nonce)"
    );

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    // fee parameters
    address public feeRecipient;
    uint16 public feeBps; // e.g., 40 = 0.4%

    // allowlists
    mapping(address => bool) public tokenAllowed; // ERC20 tokens allowed
    mapping(bytes32 => bool) public pairAllowed;  // pairKey(base, quote)

    // order state
    mapping(bytes32 => uint256) public filledBase;      // orderHash => base amount filled
    mapping(bytes32 => bool) public cancelled;         // orderHash => cancelled
    mapping(address => uint256) public minValidNonce;   // maker => minimum valid nonce (orders with nonce < minValidNonce are invalid)

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event FeeParamsUpdated(uint16 feeBps, address feeRecipient);
    event TokenAllowedSet(address indexed token, bool allowed);
    event PairAllowedSet(address indexed base, address indexed quote, bool allowed);
    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        address base,
        address quote,
        uint8 side,
        uint256 fillAmountBase,
        uint256 fillAmountQuote,
        uint256 feeQuote,
        address feePayer
    );
    event OrderCancelled(bytes32 indexed orderHash, address indexed maker);
    event CancelUpTo(address indexed maker, uint256 newMinNonce);

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    // Defaults: feeRecipient to provided address, feeBps = 40 (0.4%)
    // You can change them later via setFeeParams as the owner.
    constructor() EIP712("OrderBook", "1") {
        feeRecipient = 0x2D4C480247f0Ad0977C7a03F10d3b737872ac1f4;
        feeBps = 40; // 0.4%
    }

    // ---------------------------------------------------------------------
    // Owner functions
    // ---------------------------------------------------------------------

    function setFeeParams(uint16 _feeBps, address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "fee recipient = 0");
        require(_feeBps <= 1_000, "fee too high"); // cap at 10%
        feeBps = _feeBps;
        feeRecipient = _feeRecipient;
        emit FeeParamsUpdated(_feeBps, _feeRecipient);
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        require(token != address(0), "token = 0");
        tokenAllowed[token] = allowed;
        emit TokenAllowedSet(token, allowed);
    }

    function setPairAllowed(address base, address quote, bool allowed) external onlyOwner {
        require(tokenAllowed[base] && tokenAllowed[quote], "tokens not allowed");
        bytes32 key = pairKey(base, quote);
        pairAllowed[key] = allowed;
        emit PairAllowedSet(base, quote, allowed);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ---------------------------------------------------------------------
    // Order management
    // ---------------------------------------------------------------------

    function cancelOrder(Order calldata o) external {
        require(o.maker == msg.sender, "not maker");
        bytes32 h = _hashOrder(o);
        cancelled[h] = true;
        emit OrderCancelled(h, msg.sender);
    }

    function cancelUpTo(uint256 newMinNonce) external {
        require(newMinNonce > minValidNonce[msg.sender], "nonce not increasing");
        minValidNonce[msg.sender] = newMinNonce;
        emit CancelUpTo(msg.sender, newMinNonce);
    }

    // ---------------------------------------------------------------------
    // Fill functions
    // ---------------------------------------------------------------------

    function fillOrder(
        Order calldata o,
        bytes calldata sig,
        uint256 fillAmountBase
    ) external nonReentrant whenNotPaused returns (uint256 filledBaseOut, uint256 filledQuoteOut, uint256 feeQuoteOut) {
        (bytes32 h, uint256 fillBase, uint256 fillQuote, uint256 fee, address feePayer) = _validateAndCompute(o, sig, fillAmountBase);
        _settle(o, fillBase, fillQuote, fee, feePayer, msg.sender);
        filledBase[h] += fillBase;
        emit OrderFilled(h, o.maker, msg.sender, o.base, o.quote, o.side, fillBase, fillQuote, fee, feePayer);
        return (fillBase, fillQuote, fee);
    }

    function fillOrders(
        Order[] calldata orders,
        bytes[] calldata sigs,
        uint256[] calldata fillAmountsBase
    ) external nonReentrant whenNotPaused returns (uint256 totalBase, uint256 totalQuote, uint256 totalFee) {
        require(orders.length == sigs.length && orders.length == fillAmountsBase.length, "length mismatch");
        for (uint256 i = 0; i < orders.length; i++) {
            (bytes32 h, uint256 fillBase, uint256 fillQuote, uint256 fee, address feePayer) = _validateAndCompute(orders[i], sigs[i], fillAmountsBase[i]);
            _settle(orders[i], fillBase, fillQuote, fee, feePayer, msg.sender);
            filledBase[h] += fillBase;
            emit OrderFilled(h, orders[i].maker, msg.sender, orders[i].base, orders[i].quote, orders[i].side, fillBase, fillQuote, fee, feePayer);
            totalBase += fillBase;
            totalQuote += fillQuote;
            totalFee += fee;
        }
    }

    // ---------------------------------------------------------------------
    // Views/helpers
    // ---------------------------------------------------------------------

    function pairKey(address base, address quote) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(base, quote));
    }

    function remainingBase(Order calldata o) external view returns (uint256) {
        bytes32 h = _hashOrder(o);
        if (cancelled[h] || o.nonce < minValidNonce[o.maker]) return 0;
        uint256 f = filledBase[h];
        return o.amount > f ? (o.amount - f) : 0;
    }

    function orderHash(Order calldata o) external view returns (bytes32) {
        return _hashOrder(o);
    }

    // ---------------------------------------------------------------------
    // Internal logic
    // ---------------------------------------------------------------------

    function _validateAndCompute(
        Order calldata o,
        bytes calldata sig,
        uint256 fillAmountBase
    ) internal view returns (
        bytes32 h,
        uint256 fillBase,
        uint256 fillQuote,
        uint256 fee,
        address feePayer
    ) {
        require(o.side == 0 || o.side == 1, "bad side");
        require(o.price > 0 && o.amount > 0 && fillAmountBase > 0, "bad amount/price");
        require(block.timestamp <= o.expiry, "expired");
        require(tokenAllowed[o.base] && tokenAllowed[o.quote], "token not allowed");
        require(pairAllowed[pairKey(o.base, o.quote)], "pair not allowed");
        require(o.nonce >= minValidNonce[o.maker], "nonce invalid");

        h = _hashOrder(o);
        require(!cancelled[h], "cancelled");
        uint256 already = filledBase[h];
        require(already < o.amount, "fully filled");

        address signer = ECDSA.recover(h, sig);
        require(signer == o.maker, "bad sig");

        uint256 remaining = o.amount - already;
        fillBase = fillAmountBase < remaining ? fillAmountBase : remaining;
        fillQuote = (fillBase * o.price) / PRICE_DECIMALS;
        fee = (fillQuote * feeBps) / BPS_DENOMINATOR;
        feePayer = (o.side == 0) ? msg.sender /* taker pays quote */ : o.maker /* maker pays quote */;
    }

    function _settle(
        Order calldata o,
        uint256 fillBase,
        uint256 fillQuote,
        uint256 fee,
        address feePayer,
        address taker
    ) internal {
        IERC20 base = IERC20(o.base);
        IERC20 quote = IERC20(o.quote);

        if (o.side == 0) {
            // SELL: maker sells base, taker pays quote (+fee)
            // Transfers:
            // - base: from maker -> taker (fillBase)
            // - quote: from taker -> maker (fillQuote)
            // - fee quote: from taker -> feeRecipient (fee)
            base.safeTransferFrom(o.maker, taker, fillBase);
            quote.safeTransferFrom(taker, o.maker, fillQuote);
            if (fee > 0) quote.safeTransferFrom(feePayer, feeRecipient, fee);
        } else {
            // BUY: maker buys base, maker pays quote (+fee)
            // Transfers:
            // - base: from taker -> maker (fillBase)
            // - quote: from maker -> taker (fillQuote)
            // - fee quote: from maker -> feeRecipient (fee)
            base.safeTransferFrom(taker, o.maker, fillBase);
            quote.safeTransferFrom(o.maker, taker, fillQuote);
            if (fee > 0) quote.safeTransferFrom(feePayer, feeRecipient, fee);
        }
    }

    function _hashOrder(Order calldata o) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                o.maker,
                o.base,
                o.quote,
                o.side,
                o.amount,
                o.price,
                o.expiry,
                o.nonce
            )
        );
        return _hashTypedDataV4(structHash);
    }
}

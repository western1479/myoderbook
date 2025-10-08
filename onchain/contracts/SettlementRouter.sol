// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address owner) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function decimals() external view returns (uint8);
}

interface ICookBook {
    struct Order {
        address maker;
        address base;
        address quote;
        uint8 side; // 0 SELL (maker sells base), 1 BUY (maker buys base)
        uint256 amount; // base amount
        uint256 price;  // quote per base, 18 decimals
        uint256 expiry;
        uint256 nonce;
    }
    function feeBps() external view returns (uint16);
    function fillOrder(Order calldata o, bytes calldata sig, uint256 fillAmountBase) external returns (uint256 filledBaseOut, uint256 filledQuoteOut, uint256 feeQuoteOut);
}

/**
 * @title SettlementRouter
 * @notice Pulls the taker payment token via ERC20 allowance from a user wallet, approves CookBook, and calls fillOrder.
 *         The router receives the output token (as taker) and immediately forwards it to the user.
 *         This allows a relayer/executor to pay only gas while users provide the tokens via approval.
 */
contract SettlementRouter {
    error InsufficientPull();

    ICookBook public immutable CookBook;

    constructor(address _CookBook) {
        require(_CookBook != address(0), "CookBook");
        CookBook = ICookBook(_CookBook);
    }

    function _quoteFor(uint256 fillBase, uint256 price) internal pure returns (uint256) {
        // price has 18 decimals; base may have its own decimals but fillBase is in base units already.
        // Quote = fillBase * price / 1e18
        return (fillBase * price) / 1e18;
    }

    /**
     * @dev Fill using standard ERC20 approvals. The user (taker) must have approved this router for the required token and amount.
     * @param o The maker order
     * @param sig Maker EIP-712 signature
     * @param fillBase Amount of base to fill
     * @param taker The real taker address providing tokens via allowance; receives the output tokens
     */
    function fillWithAllowance(ICookBook.Order calldata o, bytes calldata sig, uint256 fillBase, address taker) external returns (uint256 filledBaseOut, uint256 filledQuoteOut, uint256 feeQuoteOut) {
        require(taker != address(0), "taker");

        // Determine which token the taker must pay
        address payToken = o.side == 0 ? o.quote : o.base;
        address outToken = o.side == 0 ? o.base : o.quote;

        // Compute required payment. SELL maker => taker pays quote (+fee); BUY maker => taker pays base
        uint16 fee = CookBook.feeBps();
        uint256 quoteAmt = _quoteFor(fillBase, o.price);
        uint256 payAmount = (o.side == 0)
            ? (quoteAmt + (quoteAmt * fee) / 10000)
            : fillBase;

        // Pull taker funds into router and approve CookBook
        // NOTE: the user must have approved this router for payToken >= payAmount prior to this call.
        if (!IERC20(payToken).transferFrom(taker, address(this), payAmount)) revert InsufficientPull();
        // Approve exact amount (reset to 0 first for some tokens)
        IERC20(payToken).approve(address(CookBook), 0);
        IERC20(payToken).approve(address(CookBook), payAmount);

        // Call CookBook as taker (msg.sender = router). The CookBook will use msg.sender for transfers.
        (filledBaseOut, filledQuoteOut, feeQuoteOut) = CookBook.fillOrder(o, sig, fillBase);

        // Forward the received output tokens to the taker
        uint256 outAmt = (o.side == 0) ? filledBaseOut : filledQuoteOut;
        if (outAmt > 0) {
            IERC20(outToken).transfer(taker, outAmt);
        }

        // If any leftover (e.g., overpayment due to fee rounding), return to taker just in case
        uint256 balPay = IERC20(payToken).balanceOf(address(this));
        if (balPay > 0) {
            IERC20(payToken).transfer(taker, balPay);
        }
    }
}

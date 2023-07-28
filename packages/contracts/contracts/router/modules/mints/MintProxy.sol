// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

contract MintProxy is ReentrancyGuard {
  // --- Structs ---

  struct Fee {
    address recipient;
    uint256 amount;
  }

  struct MintDetail {
    address to;
    bytes data;
    uint256 value;
    Fee[] fees;
  }

  struct MintParams {
    address refundTo;
    bool revertIfIncomplete;
  }

  // --- Errors ---

  error AlreadyInitialized();
  error UnsuccessfulMint();
  error UnsuccessfulPayment();

  // --- Fields ---

  address public owner;

  // --- Initializer ---

  function initialize(address _owner) external {
    if (owner != address(0)) {
      revert AlreadyInitialized();
    }

    owner = _owner;
  }

  // --- Methods ---

  function mintMultiple(
    MintDetail[] calldata mintDetails,
    MintParams calldata params
  ) external payable nonReentrant {
    uint256 length = mintDetails.length;
    for (uint256 i; i < length; ) {
      MintDetail calldata mintDetail = mintDetails[i];

      (bool result, ) = mintDetail.to.call{value: mintDetail.value}(mintDetail.data);
      if (!result && params.revertIfIncomplete) {
        revert UnsuccessfulMint();
      } else if (result) {
        Fee[] calldata fees = mintDetail.fees;

        uint256 feesLength = fees.length;
        for (uint256 j; j < feesLength; ) {
          _sendETH(fees[j].recipient, fees[j].amount);

          unchecked {
            ++j;
          }
        }
      }

      unchecked {
        ++i;
      }
    }

    uint256 leftover = address(this).balance;
    if (leftover > 0) {
      _sendETH(params.refundTo, leftover);
    }
  }

  // --- ERC721 / ERC1155 hooks ---

  function onERC721Received(
    address, // operator
    address, // from
    uint256 tokenId,
    bytes calldata // data
  ) external returns (bytes4) {
    IERC721(msg.sender).safeTransferFrom(address(this), owner, tokenId);

    return this.onERC721Received.selector;
  }

  function onERC1155Received(
    address, // operator
    address, // from
    uint256 tokenId,
    uint256 amount,
    bytes calldata // data
  ) external returns (bytes4) {
    IERC1155(msg.sender).safeTransferFrom(address(this), owner, tokenId, amount, "");

    return this.onERC1155Received.selector;
  }

  // --- Internal ---

  function _sendETH(address to, uint256 amount) internal {
    if (amount > 0) {
      (bool success, ) = payable(to).call{value: amount}("");
      if (!success) {
        revert UnsuccessfulPayment();
      }
    }
  }
}
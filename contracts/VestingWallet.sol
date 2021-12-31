// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.4.1 (finance/VestingWallet.sol)
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/utils/Address.sol';
import './interfaces/IVestingWallet.sol';

/**
 * @title VestingWallet
 * @dev This contract handles the vesting of Eth and ERC20 tokens for a given beneficiary. Custody of multiple tokens
 * can be given to this contract, which will release the token to the beneficiary following a given vesting schedule.
 * The vesting schedule is customizable through the {vestedAmount} function.
 *
 * Any token transferred to this contract will follow the vesting schedule as if they were locked from the beginning.
 * Consequently, if the vesting has already started, any amount of tokens sent to this contract will (at least partly)
 * be immediately releasable.
 */
contract VestingWallet is IVestingWallet {
  address internal _owner;
  address internal _eth = 0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF;
  address public override beneficiary;
  mapping(address => uint256) public override amountPerToken;
  mapping(address => uint64) public override releaseDatePerToken;
  mapping(address => uint64) public override startDatePerToken;
  mapping(address => uint256) public override releasedPerToken;

  using SafeERC20 for IERC20;

  /**
   * @dev Set the beneficiary, start timestamp and vesting duration of the vesting wallet.
   */
  constructor(address _beneficiary) {
    _owner = msg.sender;
    beneficiary = _beneficiary;
  }

  /**
   * @dev The contract should be able to receive Eth.
   */
  // solhint-disable no-empty-blocks
  receive() external payable {}

  function addBenefit(
    uint64 _startDate,
    uint64 _duration,
    address _token,
    uint256 _amount
  ) external override onlyOwner {
    if (amountPerToken[_token] != 0) {
      release(_token);
    }

    IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

    startDatePerToken[_token] = _startDate;
    releaseDatePerToken[_token] = _startDate + _duration;

    uint256 pendingAmount = amountPerToken[_token] - releasedPerToken[_token];
    amountPerToken[_token] = _amount + pendingAmount;
    releasedPerToken[_token] = 0;
  }

  function addBenefit(uint64 _startDate, uint64 _duration) external payable override onlyOwner {
    if (amountPerToken[_eth] != 0) {
      release();
    }

    startDatePerToken[_eth] = _startDate;
    releaseDatePerToken[_eth] = _startDate + _duration;

    uint256 pendingAmount = amountPerToken[_eth] - releasedPerToken[_eth];
    amountPerToken[_eth] = msg.value + pendingAmount;
    releasedPerToken[_eth] = 0;
  }

  function removeBenefit() external override onlyOwner {
    release();

    uint256 transferToOwner = amountPerToken[_eth] - releasedPerToken[_eth];

    releasedPerToken[_eth] = 0;
    amountPerToken[_eth] = 0;

    if (transferToOwner != 0) {
      Address.sendValue(payable(msg.sender), transferToOwner);
    }
  }

  function removeBenefit(address _token) external override onlyOwner {
    release(_token);

    uint256 transferToOwner = amountPerToken[_token] - releasedPerToken[_token];

    releasedPerToken[_token] = 0;
    amountPerToken[_token] = 0;

    if (transferToOwner != 0) {
      IERC20(_token).safeTransfer(msg.sender, transferToOwner);
    }
  }

  /**
   * @dev Release the native token (ether) that have already vested.
   *
   * Emits a {TokensReleased} event.
   */
  function release() public virtual override {
    uint256 releasable = _releasableSchedule(_eth) - releasedPerToken[_eth];
    releasedPerToken[_eth] += releasable;
    emit EtherReleased(releasable);
    Address.sendValue(payable(beneficiary), releasable);
  }

  /**
   * @dev Release the tokens that have already vested.
   *
   * Emits a {TokensReleased} event.
   */
  function release(address _token) public virtual override {
    uint256 releasable = _releasableSchedule(_token) - releasedPerToken[_token];
    releasedPerToken[_token] += releasable;
    emit ERC20Released(_token, releasable);
    SafeERC20.safeTransfer(IERC20(_token), beneficiary, releasable);
  }

  /**
   * @dev Calculates the amount of tokens that has already vested. Default implementation is a linear vesting curve.
   */
  function _releasableSchedule(address _token) internal view virtual returns (uint256) {
    uint64 _timestamp = uint64(block.timestamp);
    uint64 _start = startDatePerToken[_token];
    uint64 _duration = releaseDatePerToken[_token] - startDatePerToken[_token];
    uint256 _totalAllocation = amountPerToken[_token];

    if (_timestamp < _start) {
      return 0;
    } else if (_timestamp > _start + _duration) {
      return _totalAllocation;
    } else {
      return (_totalAllocation * (_timestamp - _start)) / _duration;
    }
  }

  function releasableAmount() public view virtual override returns (uint256) {
    return _releasableSchedule(_eth) - releasedPerToken[_eth];
  }

  function releasableAmount(address _token) public view virtual override returns (uint256) {
    return _releasableSchedule(_token) - releasedPerToken[_token];
  }

  function sendDust(address _token) public override onlyOwner {
    uint256 amount;
    if (_token == _eth) {
      amount = address(this).balance - amountPerToken[_eth];
      payable(_owner).transfer(amount);
    } else {
      amount = IERC20(_token).balanceOf(address(this)) - amountPerToken[_token];
      IERC20(_token).safeTransfer(_owner, amount);
    }
    emit DustSent(_token, amount, _owner);
  }

  function sendDust() external override onlyOwner {
    sendDust(_eth);
  }

  modifier onlyOwner() {
    if (msg.sender != _owner) {
      revert Unauthorized();
    }
    _;
  }
}

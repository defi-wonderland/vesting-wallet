// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.4.1 (finance/VestingWallet.sol)
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/utils/Address.sol';
import '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';
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
  mapping(address => uint256) public override totalAmountPerToken;
  mapping(address => mapping(address => uint256)) public override amount; // beneficiary => token => amount
  mapping(address => mapping(address => uint64)) public override releaseDate; // beneficiary => token => releaseDate
  mapping(address => mapping(address => uint64)) public override startDate; // beneficiary => token => startDate
  mapping(address => mapping(address => uint256)) public override released; // beneficiary => token => released

  EnumerableSet.AddressSet internal _beneficiaries;

  using SafeERC20 for IERC20;
  using EnumerableSet for EnumerableSet.AddressSet;

  /**
   * @dev Set the beneficiary, start timestamp and vesting duration of the vesting wallet.
   */
  constructor() {
    _owner = msg.sender;
  }

  /**
   * @dev The contract should be able to receive Eth.
   */
  // solhint-disable no-empty-blocks
  receive() external payable {}

  function isBeneficiary(address _beneficiary) public view override returns (bool) {
    return _beneficiaries.contains(_beneficiary);
  }

  function addBenefit(
    address _beneficiary,
    uint64 _startDate,
    uint64 _duration,
    address _token,
    uint256 _amount
  ) public override onlyOwner {
    if (_token == _eth) revert InvalidToken();

    _addBenefit(_beneficiary, _startDate, _duration, _token, _amount);

    IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
  }

  function addBenefit(
    address _beneficiary,
    uint64 _startDate,
    uint64 _duration
  ) external payable override onlyOwner {
    uint256 _amount = msg.value;

    _addBenefit(_beneficiary, _startDate, _duration, _eth, _amount);
  }

  function _addBenefit(
    address _beneficiary,
    uint64 _startDate,
    uint64 _duration,
    address _token,
    uint256 _amount
  ) internal {
    if (!isBeneficiary(_beneficiary)) {
      _beneficiaries.add(_beneficiary);
    }

    if (amount[_beneficiary][_token] != 0) {
      release(_beneficiary, _token);
    }

    startDate[_beneficiary][_token] = _startDate;
    releaseDate[_beneficiary][_token] = _startDate + _duration;

    uint256 pendingAmount = amount[_beneficiary][_token] - released[_beneficiary][_token];
    amount[_beneficiary][_token] = _amount + pendingAmount;
    totalAmountPerToken[_token] += _amount;
    released[_beneficiary][_token] = 0;
  }

  function removeBenefit(address _beneficiary) external override onlyOwner {
    _removeBenefit(_beneficiary, _eth);
  }

  function removeBenefit(address _beneficiary, address _token) external override onlyOwner {
    _removeBenefit(_beneficiary, _token);
  }

  function _removeBenefit(address _beneficiary, address _token) internal returns (uint256 _transferToOwner) {
    release(_beneficiary, _token);

    _transferToOwner = amount[_beneficiary][_token] - released[_beneficiary][_token];

    released[_beneficiary][_token] = 0;
    amount[_beneficiary][_token] = 0;
    totalAmountPerToken[_token] -= _transferToOwner;

    if (_transferToOwner != 0) {
      if (_token != _eth) {
        IERC20(_token).safeTransfer(msg.sender, _transferToOwner);
      } else {
        Address.sendValue(payable(msg.sender), _transferToOwner);
      }
    }
  }

  /**
   * @dev Release the native token (ether) that have already vested.
   *
   * Emits a {TokensReleased} event.
   */
  function release(address _beneficiary) public virtual override {
    _release(_beneficiary, _eth);
  }

  /**
   * @dev Release the tokens that have already vested.
   *
   * Emits a {TokensReleased} event.
   */
  function release(address _beneficiary, address _token) public virtual override {
    _release(_beneficiary, _token);
  }

  function _release(address _beneficiary, address _token) internal {
    uint256 releasable = _releasableSchedule(_beneficiary, _token) - released[_beneficiary][_token];

    if (releasable == 0) {
      return;
    }

    released[_beneficiary][_token] += releasable;
    totalAmountPerToken[_token] -= releasable;

    emit BenefitReleased(_token, releasable);
    if (_token != _eth) {
      SafeERC20.safeTransfer(IERC20(_token), _beneficiary, releasable);
    } else {
      Address.sendValue(payable(_beneficiary), releasable);
    }
  }

  /**
   * @dev Calculates the amount of tokens that has already vested. Default implementation is a linear vesting curve.
   */
  function _releasableSchedule(address _beneficiary, address _token) internal view virtual returns (uint256) {
    uint64 _timestamp = uint64(block.timestamp);
    uint64 _start = startDate[_beneficiary][_token];
    uint64 _duration = releaseDate[_beneficiary][_token] - startDate[_beneficiary][_token];
    uint256 _totalAllocation = amount[_beneficiary][_token];

    if (_timestamp < _start) {
      return 0;
    } else if (_timestamp > _start + _duration) {
      return _totalAllocation;
    } else {
      return (_totalAllocation * (_timestamp - _start)) / _duration;
    }
  }

  function releasableAmount(address _beneficiary) public view virtual override returns (uint256) {
    return _releasableSchedule(_beneficiary, _eth) - released[_beneficiary][_eth];
  }

  function releasableAmount(address _beneficiary, address _token) public view virtual override returns (uint256) {
    return _releasableSchedule(_beneficiary, _token) - released[_beneficiary][_token];
  }

  function sendDust(address _token) public override onlyOwner {
    uint256 _amount;
    if (_token == _eth) {
      _amount = address(this).balance - totalAmountPerToken[_eth];
      payable(_owner).transfer(_amount);
    } else {
      _amount = IERC20(_token).balanceOf(address(this)) - totalAmountPerToken[_token];
      IERC20(_token).safeTransfer(_owner, _amount);
    }
    emit DustSent(_token, _amount, _owner);
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

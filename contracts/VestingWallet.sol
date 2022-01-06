// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/utils/math/Math.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';
import './Governable.sol';
import './interfaces/IVestingWallet.sol';

contract VestingWallet is IVestingWallet, Governable {
  using SafeERC20 for IERC20;
  using EnumerableSet for EnumerableSet.AddressSet;

  mapping(address => uint256) public override totalAmountPerToken;

  mapping(address => mapping(address => Benefit)) public override benefits;

  // TODO: create a getter for beneficiaries
  EnumerableSet.AddressSet internal _beneficiaries;

  // TODO: create an AddressSet for tokens

  constructor(address _governance) Governable(_governance) {}

  function releaseDate(address _beneficiary, address _token) public view override returns (uint256) {
    Benefit memory _benefit = benefits[_token][_beneficiary];
    return _benefit.startDate + _benefit.duration;
  }

  function isBeneficiary(address _beneficiary) public view override returns (bool) {
    return _beneficiaries.contains(_beneficiary);
  }

  function addBenefit(
    address _beneficiary,
    uint256 _startDate,
    uint256 _duration,
    address _token,
    uint256 _amount
  ) public override onlyGovernance {
    _addBenefit(_beneficiary, _startDate, _duration, _token, _amount);
    totalAmountPerToken[_token] += _amount;

    IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
  }

  function _addBenefit(
    address _beneficiary,
    uint256 _startDate,
    uint256 _duration,
    address _token,
    uint256 _amount
  ) internal {
    if (!isBeneficiary(_beneficiary)) {
      _beneficiaries.add(_beneficiary);
    }

    Benefit storage _benefit = benefits[_token][_beneficiary];

    if (_benefit.amount != 0) {
      _release(_beneficiary, _token);
    }

    _benefit.startDate = _startDate;
    _benefit.duration = _duration;

    uint256 pendingAmount = _benefit.amount - _benefit.released;
    _benefit.amount = _amount + pendingAmount;
    _benefit.released = 0;

    emit BenefitAdded(_token, _beneficiary, _amount, _startDate, _startDate + _duration);
  }

  function addBenefits(
    address _token,
    address[] memory __beneficiaries,
    uint256[] memory _amounts,
    uint256 _startDate,
    uint256 _duration
  ) external override onlyGovernance {
    uint256 _length = __beneficiaries.length;
    if (_length != _amounts.length) revert WrongInputs();

    uint256 _vestedAmount;

    for (uint256 _i; _i < _length; _i++) {
      _addBenefit(__beneficiaries[_i], _startDate, _duration, _token, _amounts[_i]);
      _vestedAmount += _amounts[_i];
    }

    totalAmountPerToken[_token] += _vestedAmount;

    IERC20(_token).safeTransferFrom(msg.sender, address(this), _vestedAmount);
  }

  function removeBenefit(address _beneficiary, address _token) external override onlyGovernance {
    _release(_beneficiary, _token);

    Benefit storage _benefit = benefits[_token][_beneficiary];

    uint256 _transferToOwner = _benefit.amount - _benefit.released;

    _benefit.released = 0;
    _benefit.amount = 0;

    totalAmountPerToken[_token] -= _transferToOwner;

    if (_transferToOwner != 0) {
      IERC20(_token).safeTransfer(msg.sender, _transferToOwner);
    }

    emit BenefitRemoved(_token, _beneficiary, _transferToOwner);
  }

  function _release(address _beneficiary, address _token) internal {
    Benefit storage _benefit = benefits[_token][_beneficiary];

    uint256 _releasable = _releasableSchedule(_benefit) - _benefit.released;

    if (_releasable == 0) {
      return;
    }

    _benefit.released += _releasable;
    totalAmountPerToken[_token] -= _releasable;

    SafeERC20.safeTransfer(IERC20(_token), _beneficiary, _releasable);

    emit BenefitReleased(_token, _beneficiary, _releasable);
  }

  function release(address _beneficiary, address _token) external override {
    _release(_beneficiary, _token);
  }

  function release(address _beneficiary, address[] memory _tokens) external override {
    uint256 _length = _tokens.length;
    for (uint256 _i; _i < _length; _i++) {
      _release(_beneficiary, _tokens[_i]);
    }
  }

  function _releasableSchedule(Benefit memory _benefit) internal view returns (uint256) {
    uint256 _timestamp = block.timestamp;
    uint256 _start = _benefit.startDate;
    uint256 _duration = _benefit.duration;
    uint256 _totalAllocation = _benefit.amount;

    if (_timestamp < _start) {
      return 0;
    } else {
      return Math.min(_totalAllocation, (_totalAllocation * (_timestamp - _start)) / _duration);
    }
  }

  function releasableAmount(address _beneficiary, address _token) public view override returns (uint256) {
    Benefit storage _benefit = benefits[_token][_beneficiary];

    return _releasableSchedule(_benefit) - _benefit.released;
  }

  function sendDust(address _token) public override onlyGovernance {
    uint256 _amount;

    _amount = IERC20(_token).balanceOf(address(this)) - totalAmountPerToken[_token];
    IERC20(_token).safeTransfer(governance, _amount);

    emit DustSent(_token, _amount, governance);
  }
}

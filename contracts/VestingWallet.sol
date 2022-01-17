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

  EnumerableSet.AddressSet internal _vestedTokens;
  EnumerableSet.AddressSet internal _beneficiaries;
  // token => amount
  mapping(address => uint256) public override totalAmountPerToken;
  // token => beneficiary => benefit
  mapping(address => mapping(address => Benefit)) public override benefits;
  // beneficiary => [tokens]
  mapping(address => EnumerableSet.AddressSet) internal _tokensPerBeneficiary;

  constructor(address _governance) Governable(_governance) {}

  // views

  function releaseDate(address _token, address _beneficiary) external view override returns (uint256) {
    Benefit memory _benefit = benefits[_token][_beneficiary];

    return _benefit.startDate + _benefit.duration;
  }

  function releasableAmount(address _token, address _beneficiary) external view override returns (uint256) {
    Benefit memory _benefit = benefits[_token][_beneficiary];

    return _releasableSchedule(_benefit) - _benefit.released;
  }

  function getBeneficiaries() external view override returns (address[] memory) {
    return _beneficiaries.values();
  }

  function getTokens() external view override returns (address[] memory) {
    return _vestedTokens.values();
  }

  function getTokensOf(address _beneficiary) external view override returns (address[] memory) {
    return _tokensPerBeneficiary[_beneficiary].values();
  }

  // methods
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

  function removeBenefit(address _token, address _beneficiary) external override onlyGovernance {
    _removeBenefit(_token, _beneficiary);
  }

  // TODO: add tests
  function removeBeneficiary(address _beneficiary) external override onlyGovernance {
    while (_tokensPerBeneficiary[_beneficiary].length() > 0) {
      _removeBenefit(_tokensPerBeneficiary[_beneficiary].at(0), _beneficiary);
    }
  }

  function release(address _token) external override {
    _release(_token, msg.sender);
  }

  function release(address _token, address _beneficiary) external override {
    _release(_token, _beneficiary);
  }

  function release(address[] memory _tokens) external override {
    uint256 _length = _tokens.length;
    address _beneficiary = msg.sender;
    for (uint256 _i; _i < _length; _i++) {
      _release(_tokens[_i], _beneficiary);
    }
  }

  function release(address[] memory _tokens, address _beneficiary) external override {
    uint256 _length = _tokens.length;
    for (uint256 _i; _i < _length; _i++) {
      _release(_tokens[_i], _beneficiary);
    }
  }

  function sendDust(address _token) public override onlyGovernance {
    uint256 _amount;

    _amount = IERC20(_token).balanceOf(address(this)) - totalAmountPerToken[_token];
    IERC20(_token).safeTransfer(governance, _amount);

    emit DustSent(_token, _amount, governance);
  }

  // internal

  function _addBenefit(
    address _beneficiary,
    uint256 _startDate,
    uint256 _duration,
    address _token,
    uint256 _amount
  ) internal {
    _beneficiaries.add(_beneficiary);
    _vestedTokens.add(_token);
    _tokensPerBeneficiary[_beneficiary].add(_token);

    Benefit storage _benefit = benefits[_token][_beneficiary];

    if (_benefit.amount != 0) {
      _release(_token, _beneficiary);
    }

    _benefit.startDate = _startDate;
    _benefit.duration = _duration;

    uint256 pendingAmount = _benefit.amount - _benefit.released;
    _benefit.amount = _amount + pendingAmount;
    _benefit.released = 0;

    emit BenefitAdded(_token, _beneficiary, _benefit.amount, _startDate, _startDate + _duration);
  }

  function _release(address _token, address _beneficiary) internal {
    Benefit storage _benefit = benefits[_token][_beneficiary];

    uint256 _releasable = _releasableSchedule(_benefit) - _benefit.released;

    if (_releasable == 0) {
      return;
    }

    _benefit.released += _releasable;
    totalAmountPerToken[_token] -= _releasable;

    if (_benefit.released == _benefit.amount) {
      _deleteBenefit(_token, _beneficiary);
    }

    SafeERC20.safeTransfer(IERC20(_token), _beneficiary, _releasable);

    emit BenefitReleased(_token, _beneficiary, _releasable);
  }

  function _removeBenefit(address _token, address _beneficiary) internal {
    _release(_token, _beneficiary);

    Benefit storage _benefit = benefits[_token][_beneficiary];

    uint256 _transferToOwner = _benefit.amount - _benefit.released;

    totalAmountPerToken[_token] -= _transferToOwner;

    if (_transferToOwner != 0) {
      IERC20(_token).safeTransfer(msg.sender, _transferToOwner);
    }

    _deleteBenefit(_token, _beneficiary);

    emit BenefitRemoved(_token, _beneficiary, _transferToOwner);
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

  function _deleteBenefit(address _token, address _beneficiary) internal {
    delete benefits[_token][_beneficiary];

    _tokensPerBeneficiary[_beneficiary].remove(_token);

    if (_tokensPerBeneficiary[_beneficiary].length() == 0) {
      _beneficiaries.remove(_beneficiary);
    }

    if (totalAmountPerToken[_token] == 0) {
      _vestedTokens.remove(_token);
    }
  }
}

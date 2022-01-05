// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import './IDustCollector.sol';

interface IVestingWallet is IDustCollector {
  // errors
  error WrongInputs();

  // events
  event BenefitAdded(address indexed token, address indexed beneficiary, uint256 amount, uint256 startDate, uint256 releaseDate);
  event BenefitRemoved(address indexed token, address indexed beneficiary, uint256 removedAmount);
  event BenefitReleased(address indexed token, address indexed beneficiary, uint256 releasedAmount);

  // methods
  function addBenefit(
    address _beneficiary,
    uint256 _startDate,
    uint256 _duration,
    address _token,
    uint256 _amount
  ) external;

  function addBenefits(
    address _token,
    address[] memory _beneficiary,
    uint256[] memory _amount,
    uint256 _startDate,
    uint256 _duration
  ) external;

  function amount(address _beneficiary, address _token) external returns (uint256);

  function isBeneficiary(address _beneficiary) external view returns (bool);

  function releasableAmount(address _beneficiary, address _token) external view returns (uint256);

  function release(address _beneficiary, address _token) external;

  function release(address _beneficiary, address[] memory _tokens) external;

  function released(address _beneficiary, address _token) external returns (uint256);

  function releaseDate(address _beneficiary, address _token) external returns (uint256);

  function removeBenefit(address _beneficiary, address _token) external;

  function startDate(address _beneficiary, address _token) external returns (uint256);

  function totalAmountPerToken(address _token) external returns (uint256);
}

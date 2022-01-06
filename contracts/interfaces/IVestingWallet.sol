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

  // structs
  struct Benefit {
    uint256 amount;
    uint256 startDate;
    uint256 duration;
    uint256 released;
  }

  // views
  function benefits(address beneficiary, address token)
    external
    returns (
      uint256 amount,
      uint256 startDate,
      uint256 duration,
      uint256 released
    );

  function releaseDate(address _token, address _beneficiary) external returns (uint256);

  function releasableAmount(address _token, address _beneficiary) external view returns (uint256);

  function isBeneficiary(address _beneficiary) external view returns (bool);

  function totalAmountPerToken(address _token) external returns (uint256);

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

  function removeBenefit(address _token, address _beneficiary) external;

  function release(address _token, address _beneficiary) external;

  function release(address[] memory _tokens, address _beneficiary) external;
}

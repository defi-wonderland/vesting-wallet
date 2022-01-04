// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import './IDustCollector.sol';

interface IVestingWallet is IDustCollector {
  function addBenefit(
    address _beneficiary,
    uint64 _startDate,
    uint64 _duration
  ) external payable;

  function addBenefit(
    address _beneficiary,
    uint64 _startDate,
    uint64 _duration,
    address _token,
    uint256 _amount
  ) external;

  function amount(address _beneficiary, address _token) external returns (uint256);

  function isBeneficiary(address _beneficiary) external view returns (bool);

  function releasableAmount(address _beneficiary, address _token) external view returns (uint256);

  function releasableAmount(address _beneficiary) external view returns (uint256);

  function release(address _beneficiary, address _token) external;

  function release(address _beneficiary) external;

  function released(address _beneficiary, address _token) external returns (uint256);

  function releaseDate(address _beneficiary, address _token) external returns (uint64);

  function removeBenefit(address _beneficiary, address _token) external;

  function removeBenefit(address _beneficiary) external;

  function startDate(address _beneficiary, address _token) external returns (uint64);

  function totalAmountPerToken(address _token) external returns (uint256);

  event BenefitReleased(address indexed token, uint256 amount);
  event ERC20Released(address indexed token, uint256 amount);
  event EtherReleased(uint256 amount);

  error NoOverloads();
  error InvalidToken();
}

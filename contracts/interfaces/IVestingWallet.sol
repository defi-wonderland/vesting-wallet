// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import './IDustCollector.sol';

interface IVestingWallet is IDustCollector {
  function addBenefit(uint64 _startDate, uint64 _duration) external payable;

  function addBenefit(
    uint64 _startDate,
    uint64 _duration,
    address _token,
    uint256 _amount
  ) external;

  function amountPerToken(address _token) external returns (uint256);

  function beneficiary() external returns (address);

  function release() external;

  function release(address _token) external;

  function releaseDatePerToken(address _token) external returns (uint64);

  function releasedPerToken(address _token) external returns (uint256);

  function removeBenefit() external;

  function removeBenefit(address _token) external;

  function startDatePerToken(address _token) external returns (uint64);

  function vestedAmount() external returns (uint256);

  function vestedAmount(address _token) external returns (uint256);

  event ERC20Released(address indexed token, uint256 amount);
  event EtherReleased(uint256 amount);

  error NoOverloads();
}

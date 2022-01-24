// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '../VestingWallet.sol';
import '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';

contract VestingWalletForTest is VestingWallet {
  using EnumerableSet for EnumerableSet.AddressSet;

  constructor(address _governance) VestingWallet(_governance) {}

  function addBeneficiaryForTest(address _beneficiary) external {
    _beneficiaries.add(_beneficiary);
  }

  function addTokenForTest(address _token) external {
    _vestedTokens.add(_token);
  }

  function addTokenToBeneficiaryForTest(address _token, address _beneficiary) external {
    _tokensPerBeneficiary[_beneficiary].add(_token);
  }
}

# Vesting Contract

This contract handles the vesting of ERC20 tokens for multiple beneficiaries. Custody of multiple tokens can be given to this contract, which will release the token to the beneficiaries following a given vesting schedule.

Tokens should be added to the contract through `addBenefit` function, any token externally transferred will be retrievable with the dust collector functionality.

The owner of the contract has the ability to change the vesting schedules, or to remove the benefits for a particular beneficiary. Anyhow, the correspondent tokens prior to any modification will be released to the beneficiary keeping the prior vesting schedule.

##### Disclaimer: non-standard ERC20s

This contract does not support non-standard ERC20 implementations where the transferred amount is not equal to the requested amount in the `transfer` params (tokens with inherent fees).

## How to use

Owner can use any of the 2 functions to vest a benefit in the contract:

- `addBenefit(token, beneficiary, amount, startDate, duration)`
- `addBenefits(token, beneficiaries[], amounts[], startDate, duration)`

He must have previously approved the ERC20 spending of the `amount`, or the sum of `amounts[]`.

Beneficiaries, at any given point, can claim their rewards using any of the following functions to release their tokens:

- `release(token, beneficiary)`
- `release(tokens[], beneficiary)`
  // TODO:
- `release(token)` (uses `msg.sender` as beneficiary)
- `release(tokens[])` (uses `msg.sender` as beneficiary)

The contract will calculate, at the given timestamp, the amount of releasable tokens and transfer them to the rightful beneficiary. This functions have no access control, allowing anyone to use their gas for the release of the tokens.

At any given point, the owner can choose to remove the benefits to a particular beneficiary, releasing first the correspondant amount of tokens to him, and transfering the remaining amount to the owner.

- `removeBenefit(token, beneficiary)`
  // TODO:
- `removeBeneficiary(beneficiary)`

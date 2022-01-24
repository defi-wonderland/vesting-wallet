import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { JsonRpcSigner } from '@ethersproject/providers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { VestingWallet, VestingWallet__factory } from '@typechained';
import { evm, wallet } from '@utils';
import { IERC20 } from '@typechained';
import { getNodeUrl } from 'utils/network';
import forkBlockNumber from './fork-block-numbers';
import {
  DAI_ADDRESS,
  DAI_WHALE_ADDRESS,
  USDC_ADDRESS,
  USDC_WHALE_ADDRESS,
  DURATION,
  EXPECTATION_DELTA,
  PARTIAL_DURATION,
  START_DATE,
  VEST_AMOUNT,
  VEST_AMOUNT_6_DECIMALS,
} from '@utils/constants';
import { when } from '@utils/bdd';

const TOTAL_VEST_AMOUNT = VEST_AMOUNT.mul(2);

describe('VestingWallet @skip-on-coverage', () => {
  let daiWhale: JsonRpcSigner;
  let usdWhale: JsonRpcSigner;
  let beneficiary: SignerWithAddress;
  let owner: SignerWithAddress;
  let vestingWallet: VestingWallet;
  let vestingWalletFactory: VestingWallet__factory;
  let snapshotId: string;
  let dai: IERC20;
  let usdc: IERC20;

  before(async () => {
    [, beneficiary, owner] = await ethers.getSigners();
    await evm.reset({
      jsonRpcUrl: getNodeUrl('mainnet'),
      blockNumber: forkBlockNumber.dai,
    });

    dai = (await ethers.getContractAt('IERC20', DAI_ADDRESS)) as unknown as IERC20;
    usdc = (await ethers.getContractAt('IERC20', USDC_ADDRESS)) as unknown as IERC20;
    daiWhale = await wallet.impersonate(DAI_WHALE_ADDRESS);
    usdWhale = await wallet.impersonate(USDC_WHALE_ADDRESS);

    await dai.connect(daiWhale).transfer(owner.address, TOTAL_VEST_AMOUNT);
    await usdc.connect(usdWhale).transfer(owner.address, VEST_AMOUNT_6_DECIMALS);

    vestingWalletFactory = (await ethers.getContractFactory('VestingWallet')) as VestingWallet__factory;

    vestingWallet = await vestingWalletFactory.connect(owner).deploy(owner.address);

    snapshotId = await evm.snapshot.take();
  });

  beforeEach(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  after(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  when('someone sends ETH to the contract', () => {
    it('should revert', async () => {
      await expect(owner.sendTransaction({ to: vestingWallet.address, value: 1 })).to.be.revertedWith(
        "Transaction reverted: function selector was not recognized and there's no fallback nor receive function"
      );
    });
  });

  when('a provider creates a ERC20 bond, the beneficiary', () => {
    beforeEach(async () => {
      await dai.connect(owner).approve(vestingWallet.address, VEST_AMOUNT);
      await vestingWallet.connect(owner).addBenefit(beneficiary.address, START_DATE, DURATION, dai.address, VEST_AMOUNT);
    });

    it('should have all bond to claim when the duration expired', async () => {
      await evm.advanceToTimeAndBlock(START_DATE + DURATION);
      const initialBalance = await dai.callStatic.balanceOf(beneficiary.address);

      await vestingWallet.connect(beneficiary)['release(address,address)'](dai.address, beneficiary.address);

      const finalBalance = await dai.callStatic.balanceOf(beneficiary.address);

      expect(finalBalance.sub(initialBalance)).to.equal(VEST_AMOUNT);
    });

    it('should only be able to claim a proportional when the bond is active', async () => {
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / 2);
      const initialBalance = await dai.callStatic.balanceOf(beneficiary.address);

      await vestingWallet.connect(beneficiary)['release(address,address)'](dai.address, beneficiary.address);

      const finalBalance = await dai.callStatic.balanceOf(beneficiary.address);

      const released = finalBalance.sub(initialBalance);
      const expectedAmount = VEST_AMOUNT.div(2);

      expect(released).to.be.closeTo(expectedAmount, EXPECTATION_DELTA);
    });
  });

  when('a provider removes a ERC20 benefit, the contract', () => {
    beforeEach(async () => {
      await dai.connect(owner).approve(vestingWallet.address, VEST_AMOUNT);
      await vestingWallet.connect(owner).addBenefit(beneficiary.address, START_DATE, DURATION, dai.address, VEST_AMOUNT);
    });

    it('should transfer to beneficiary the total benefit if the bond is over', async () => {
      await evm.advanceToTimeAndBlock(START_DATE + DURATION);

      await vestingWallet.connect(owner).removeBenefit(dai.address, beneficiary.address);

      const beneficiaryBalance = await dai.callStatic.balanceOf(beneficiary.address);

      expect(beneficiaryBalance).to.be.equal(VEST_AMOUNT);
    });

    it('should transfer to beneficiary a proportional if the bond is active', async () => {
      const beneficiaryClaimableAmount = VEST_AMOUNT.mul(PARTIAL_DURATION).div(DURATION);

      await evm.advanceToTimeAndBlock(START_DATE + PARTIAL_DURATION);
      await vestingWallet.connect(owner).removeBenefit(dai.address, beneficiary.address);

      const beneficiaryBalance = await dai.callStatic.balanceOf(beneficiary.address);

      expect(beneficiaryBalance).to.be.closeTo(beneficiaryClaimableAmount, EXPECTATION_DELTA);
    });

    it('should transfer to owner the rest of the benefit if the bond is active', async () => {
      const ownerInitialBalance = await dai.callStatic.balanceOf(owner.address);

      await evm.advanceToTimeAndBlock(START_DATE + PARTIAL_DURATION);
      await vestingWallet.connect(owner).removeBenefit(dai.address, beneficiary.address);

      const ownerFinalBalance = await dai.callStatic.balanceOf(owner.address);

      const beneficiaryClaimableAmount = VEST_AMOUNT.mul(PARTIAL_DURATION).div(DURATION);
      expect(ownerFinalBalance.sub(ownerInitialBalance)).to.be.closeTo(VEST_AMOUNT.sub(beneficiaryClaimableAmount), EXPECTATION_DELTA);
    });

    it('should sendback to owner all the benefit if the bond did not started yet', async () => {
      await evm.advanceToTimeAndBlock(START_DATE - 1);

      const ownerInitialBalance = await dai.callStatic.balanceOf(owner.address);
      await vestingWallet.connect(owner).removeBenefit(dai.address, beneficiary.address);
      const ownerFinalBalance = await dai.callStatic.balanceOf(owner.address);

      expect(ownerFinalBalance.sub(ownerInitialBalance)).to.be.equal(VEST_AMOUNT);
    });
  });

  when('a provider do multiple claims in the same active period', () => {
    it('should only be able to claim a proportionals when a ERC20 bond is active', async () => {
      await dai.connect(owner).approve(vestingWallet.address, VEST_AMOUNT);
      await vestingWallet.connect(owner).addBenefit(beneficiary.address, START_DATE, DURATION, dai.address, VEST_AMOUNT);

      // call release after half bonded time
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / 2);
      const initialBalance = await dai.callStatic.balanceOf(beneficiary.address);
      await vestingWallet.connect(beneficiary)['release(address,address)'](dai.address, beneficiary.address);

      // call release after another quarter of bonded time
      await evm.advanceToTimeAndBlock(START_DATE + (DURATION * 3) / 4);
      const stepBalance = await dai.callStatic.balanceOf(beneficiary.address);
      await vestingWallet.connect(beneficiary)['release(address,address)'](dai.address, beneficiary.address);

      const finalBalance = await dai.callStatic.balanceOf(beneficiary.address);

      const firstClaim = stepBalance.sub(initialBalance);
      const secondClaim = finalBalance.sub(stepBalance);
      const expectedAmount = VEST_AMOUNT.mul(3).div(4);

      expect(firstClaim.add(secondClaim)).to.be.closeTo(expectedAmount, EXPECTATION_DELTA);
    });
  });

  when('a provider do a ERC20 re-vesting', () => {
    beforeEach(async () => {
      await dai.connect(owner).approve(vestingWallet.address, TOTAL_VEST_AMOUNT);
      await vestingWallet.connect(owner).addBenefit(beneficiary.address, START_DATE, DURATION, dai.address, VEST_AMOUNT);
    });

    it('should transfer to beneficiary the total previous benefit if the previous bond is over', async () => {
      await evm.advanceToTimeAndBlock(START_DATE + DURATION);

      await vestingWallet.connect(owner).addBenefit(beneficiary.address, START_DATE, DURATION, dai.address, VEST_AMOUNT);

      const beneficiaryBalance = await dai.callStatic.balanceOf(beneficiary.address);
      expect(beneficiaryBalance).to.be.equal(VEST_AMOUNT);
    });

    it('should transfer to beneficiary a proportional of the previous benefit if the previous bond is active', async () => {
      const beneficiaryClaimableAmount = VEST_AMOUNT.mul(PARTIAL_DURATION).div(DURATION);
      await evm.advanceToTimeAndBlock(START_DATE + PARTIAL_DURATION);

      await vestingWallet.connect(owner).addBenefit(beneficiary.address, START_DATE, DURATION, dai.address, VEST_AMOUNT);

      const beneficiaryBalance = await dai.callStatic.balanceOf(beneficiary.address);
      expect(beneficiaryBalance).to.be.closeTo(beneficiaryClaimableAmount, EXPECTATION_DELTA);
    });

    it('should reinvest the rest of the previous benefit if the previous bond is active', async () => {
      const beneficiaryClaimableAmount = VEST_AMOUNT.mul(PARTIAL_DURATION).div(DURATION);
      await evm.advanceToTimeAndBlock(START_DATE + PARTIAL_DURATION);

      await vestingWallet.connect(owner).addBenefit(beneficiary.address, START_DATE, DURATION, dai.address, VEST_AMOUNT);

      const contractDaiBalance = await vestingWallet.callStatic.totalAmountPerToken(dai.address);
      expect(contractDaiBalance).to.be.closeTo(TOTAL_VEST_AMOUNT.sub(beneficiaryClaimableAmount), EXPECTATION_DELTA);
    });

    it('should reinvest all the previous benefit if the previous bond did not started yet', async () => {
      await evm.advanceToTimeAndBlock(START_DATE - 1);

      await vestingWallet.connect(owner).addBenefit(beneficiary.address, START_DATE, DURATION, dai.address, VEST_AMOUNT);

      const contractDaiBalance = await vestingWallet.callStatic.totalAmountPerToken(dai.address);
      expect(contractDaiBalance).to.be.equal(TOTAL_VEST_AMOUNT);
    });

    it('should success with a release between the two completed vest', async () => {
      await evm.advanceToTimeAndBlock(START_DATE + DURATION);

      await vestingWallet.connect(owner)['release(address,address)'](dai.address, beneficiary.address);
      await vestingWallet.connect(owner).addBenefit(beneficiary.address, START_DATE + DURATION, DURATION, dai.address, VEST_AMOUNT);

      await evm.advanceToTimeAndBlock(START_DATE + 2 * DURATION);

      await vestingWallet.connect(owner)['release(address,address)'](dai.address, beneficiary.address);

      const beneficiaryDaiBalance = await dai.callStatic.balanceOf(beneficiary.address);
      expect(beneficiaryDaiBalance).to.be.equal(TOTAL_VEST_AMOUNT);
    });

    it('should success with a release between the two in progress vest', async () => {
      const NEW_START_DATE = START_DATE + DURATION;
      const beneficiaryClaimableAmount = VEST_AMOUNT.mul(PARTIAL_DURATION).div(DURATION);
      await evm.advanceToTimeAndBlock(START_DATE + PARTIAL_DURATION);
      await vestingWallet.connect(owner)['release(address,address)'](dai.address, beneficiary.address);

      await evm.advanceToTimeAndBlock(START_DATE + DURATION);
      await vestingWallet.connect(owner).addBenefit(beneficiary.address, NEW_START_DATE, DURATION, dai.address, VEST_AMOUNT);

      await evm.advanceToTimeAndBlock(NEW_START_DATE + PARTIAL_DURATION);
      await vestingWallet.connect(owner)['release(address,address)'](dai.address, beneficiary.address);

      const beneficiaryDaiBalance = await dai.callStatic.balanceOf(beneficiary.address);
      expect(beneficiaryDaiBalance).to.be.closeTo(VEST_AMOUNT.add(beneficiaryClaimableAmount), EXPECTATION_DELTA);
    });
  });

  when('a provider creates USDC bond', () => {
    beforeEach(async () => {
      await usdc.connect(owner).approve(vestingWallet.address, VEST_AMOUNT_6_DECIMALS);
      await vestingWallet.connect(owner).addBenefit(beneficiary.address, START_DATE, DURATION, usdc.address, VEST_AMOUNT_6_DECIMALS);
    });

    it('should work', async () => {
      expect((await vestingWallet.benefits(usdc.address, beneficiary.address)).amount).to.eq(VEST_AMOUNT_6_DECIMALS);
    });
  });
});

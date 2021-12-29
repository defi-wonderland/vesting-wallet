import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { JsonRpcSigner } from '@ethersproject/providers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { VestingWallet, VestingWallet__factory } from '@typechained';
import { evm, wallet } from '@utils';
import { toUnit } from '@utils/bn';
import { IERC20 } from '@typechained';
import { getNodeUrl } from 'utils/network';
import forkBlockNumber from './fork-block-numbers';
import { DAI } from '@utils/constants';
import { when } from '@utils/bdd';
import { BigNumber } from '@ethersproject/bignumber';

const daiWhaleAddress = '0x16463c0fdb6ba9618909f5b120ea1581618c1b9e';
const VEST_AMOUNT = toUnit(100);
const EXPECTATION_DELTA = toUnit(0.005).toNumber();

describe('VestingWallet @skip-on-coverage', () => {
  let daiWhale: JsonRpcSigner;
  let beneficiary: SignerWithAddress;
  let owner: SignerWithAddress;
  let vestingWallet: VestingWallet;
  let vestingWalletFactory: VestingWallet__factory;
  let snapshotId: string;
  let dai: IERC20;
  let startDate: BigNumber;
  let duration: BigNumber;

  before(async () => {
    [beneficiary, owner] = await ethers.getSigners();
    await evm.reset({
      jsonRpcUrl: getNodeUrl('mainnet'),
      blockNumber: forkBlockNumber.dai,
    });

    dai = (await ethers.getContractAt('IERC20', DAI)) as unknown as IERC20;
    daiWhale = await wallet.impersonate(daiWhaleAddress);

    await dai.connect(daiWhale).transfer(owner.address, VEST_AMOUNT);

    vestingWalletFactory = (await ethers.getContractFactory('VestingWallet')) as VestingWallet__factory;

    vestingWallet = await vestingWalletFactory.connect(owner).deploy(beneficiary.address);

    startDate = BigNumber.from((await ethers.provider.getBlock(forkBlockNumber.dai)).timestamp);
    duration = BigNumber.from(60 * 60 * 24 * 3); // 3 months

    snapshotId = await evm.snapshot.take();
  });

  beforeEach(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  it('should set the beneficiary address', async () => {
    expect(await vestingWallet.beneficiary()).to.equal(beneficiary.address);
  });

  when('a provider creates a ETH bond, the beneficiary', () => {
    beforeEach(async () => {
      await evm.snapshot.revert(snapshotId);
      await vestingWallet.connect(owner)['addBenefit(uint64,uint64)'](startDate, duration, {
        value: VEST_AMOUNT,
      });
    });

    it('should have all bond to claim when the duration expired', async () => {
      await evm.advanceTimeAndBlock(duration.toNumber());

      const initialBalance = await ethers.provider.getBalance(beneficiary.address);

      const tx = await vestingWallet.connect(beneficiary)['release()']();
      const gasUsed = (await tx.wait()).gasUsed;
      const gasPrice = (await tx.wait()).effectiveGasPrice;

      const finalBalance = await ethers.provider.getBalance(beneficiary.address);

      expect(finalBalance.sub(initialBalance)).to.equal(VEST_AMOUNT.sub(gasUsed.mul(gasPrice)));
    });

    it('should only be able to claim a proportional when the the bond is active', async () => {
      await evm.advanceTimeAndBlock(duration.div(2).toNumber());

      const initialBalance = await ethers.provider.getBalance(beneficiary.address);

      await vestingWallet.connect(beneficiary)['release()']();

      const finalBalance = await ethers.provider.getBalance(beneficiary.address);

      const released = finalBalance.sub(initialBalance);
      const expectedAmount = VEST_AMOUNT.div(2);

      expect(released).to.be.closeTo(expectedAmount, EXPECTATION_DELTA);
    });
  });

  when('a provider creates a ERC20 bond, the beneficiary', () => {
    beforeEach(async () => {
      await evm.snapshot.revert(snapshotId);
      await dai.connect(owner).approve(vestingWallet.address, VEST_AMOUNT);
      await vestingWallet.connect(owner)['addBenefit(uint64,uint64,address,uint256)'](startDate, duration, dai.address, VEST_AMOUNT);
    });

    it('should have all bond to claim when the duration expired', async () => {
      await evm.advanceTimeAndBlock(duration.toNumber());
      const initialBalance = await dai.callStatic.balanceOf(beneficiary.address);

      await vestingWallet.connect(beneficiary)['release(address)'](dai.address);

      const finalBalance = await dai.callStatic.balanceOf(beneficiary.address);

      expect(finalBalance.sub(initialBalance)).to.equal(VEST_AMOUNT);
    });

    it('should only be able to claim a proportional when the the bond is active', async () => {
      await evm.advanceTimeAndBlock(duration.div(2).toNumber());
      const initialBalance = await dai.callStatic.balanceOf(beneficiary.address);

      await vestingWallet.connect(beneficiary)['release(address)'](dai.address);

      const finalBalance = await dai.callStatic.balanceOf(beneficiary.address);

      const released = finalBalance.sub(initialBalance);
      const expectedAmount = VEST_AMOUNT.div(2);

      expect(released).to.be.closeTo(expectedAmount, EXPECTATION_DELTA);
    });
  });
});

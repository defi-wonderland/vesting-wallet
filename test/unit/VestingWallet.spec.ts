import { IERC20 } from '@typechained';
import { toUnit } from '@utils/bn';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { ethers } from 'hardhat';
import { VestingWallet, VestingWallet__factory } from '@typechained';
import { evm } from '@utils';
import { DAI, ETH, NON_ZERO } from '@utils/constants';
import { BigNumber } from '@ethersproject/bignumber';
import { FakeContract, MockContract, MockContractFactory, smock } from '@defi-wonderland/smock';
import chai, { expect } from 'chai';

chai.use(smock.matchers);

const VEST_AMOUNT = toUnit(100);

describe('VestingWallet', () => {
  let vestingWallet: MockContract<VestingWallet>;
  let vestingWalletFactory: MockContractFactory<VestingWallet__factory>;
  let snapshotId: string;
  let ethProvider: SignerWithAddress;
  let owner: SignerWithAddress;
  let dai: FakeContract<IERC20>;

  before(async () => {
    [ethProvider, owner] = await ethers.getSigners();
    vestingWalletFactory = await smock.mock<VestingWallet__factory>('VestingWallet');
    vestingWallet = await vestingWalletFactory.connect(owner).deploy(NON_ZERO);
    dai = await smock.fake('ERC20', { address: DAI });

    snapshotId = await evm.snapshot.take();
  });

  beforeEach(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  it('should set the beneficiary address', async () => {
    expect(await vestingWallet.beneficiary()).to.equal(NON_ZERO);
  });

  describe('vestedAmount', () => {
    const startDate = 100_000_000_000; // timestamp in the future
    const duration = 1_000_000;
    const partialDuration = 700_000;

    context('using ERC20', () => {
      beforeEach(async () => {
        dai.transferFrom.reset();
        dai.transferFrom.returns(true);

        await vestingWallet.connect(owner)['addBenefit(uint64,uint64,address,uint256)'](startDate, duration, DAI, VEST_AMOUNT);
      });

      it('should return 0 if vest has not yet started', async () => {
        await evm.advanceToTimeAndBlock(startDate - 1);
        expect(await vestingWallet['vestedAmount(address)'](DAI)).to.be.eq(0);
      });

      it('should return total bonds if vest has finalized', async () => {
        await evm.advanceToTimeAndBlock(startDate + duration + 1);
        expect(await vestingWallet['vestedAmount(address)'](DAI)).to.be.eq(VEST_AMOUNT);
      });

      it('should return a partial amount if vest is ongoing', async () => {
        await evm.advanceToTimeAndBlock(startDate + partialDuration);
        expect(await vestingWallet['vestedAmount(address)'](DAI)).to.be.eq(VEST_AMOUNT.mul(partialDuration).div(duration));
      });
    });

    context('using ETH', () => {
      beforeEach(async () => {
        await vestingWallet.connect(owner)['addBenefit(uint64,uint64)'](startDate, duration, { value: VEST_AMOUNT });
      });

      it('should return 0 if vest has not yet started', async () => {
        await evm.advanceToTimeAndBlock(startDate - 1);
        expect(await vestingWallet['vestedAmount()']()).to.be.eq(0);
      });

      it('should return total bonds if vest has finalized', async () => {
        await evm.advanceToTimeAndBlock(startDate + duration + 1);
        expect(await vestingWallet['vestedAmount()']()).to.be.eq(VEST_AMOUNT);
      });

      it('should return a partial amount if vest is ongoing', async () => {
        await evm.advanceToTimeAndBlock(startDate + partialDuration);
        expect(await vestingWallet['vestedAmount()']()).to.be.eq(VEST_AMOUNT.mul(partialDuration).div(duration));
      });

      it('should be able to use ETH address', async () => {
        await evm.advanceToTimeAndBlock(startDate + duration);
        expect(await vestingWallet['vestedAmount(address)'](ETH)).to.be.eq(VEST_AMOUNT);
      });
    });
  });

  describe('addBenefit', () => {
    const timestamp = 1_000_000_000;
    const startDate = BigNumber.from(Math.floor(timestamp / 1000));
    const duration = BigNumber.from(3600 * 24 * 30 * 3); // 3 months
    const releaseDate = startDate.add(duration);

    context('when owner creates a ERC20 bond', () => {
      beforeEach(async () => {
        dai.transferFrom.reset();
        dai.transferFrom.returns(true);

        await vestingWallet.connect(owner)['addBenefit(uint64,uint64,address,uint256)'](startDate, duration, DAI, VEST_AMOUNT);
      });

      it('should transfer the token to the contract', async () => {
        expect(dai.transferFrom).to.be.calledOnce;
      });

      it('should update amountPerToken', async () => {
        expect(await vestingWallet.callStatic.amountPerToken(DAI)).to.equal(VEST_AMOUNT);
      });

      it('should update releaseDatePerToken', async () => {
        expect(await vestingWallet.callStatic.releaseDatePerToken(DAI)).to.equal(releaseDate);
      });

      it('should update startDatePerToken', async () => {
        expect(await vestingWallet.callStatic.startDatePerToken(DAI)).to.equal(startDate);
      });
    });

    context('when owner creates a ETH bond', () => {
      const ETH_VEST_AMOUNT = toUnit(8);

      beforeEach(async () => {
        await vestingWallet.connect(owner)['addBenefit(uint64,uint64)'](startDate, duration, {
          value: ETH_VEST_AMOUNT,
        });
      });

      it('should transfer the token to the contract', async () => {
        expect(await vestingWallet.provider.getBalance(vestingWallet.address)).to.equal(ETH_VEST_AMOUNT);
      });

      it('should update amountPerToken', async () => {
        expect(await vestingWallet.callStatic.amountPerToken(ETH)).to.equal(ETH_VEST_AMOUNT);
      });

      it('should update releaseDatePerToken', async () => {
        expect(await vestingWallet.callStatic.releaseDatePerToken(ETH)).to.equal(releaseDate);
      });

      it('should update startDatePerToken', async () => {
        expect(await vestingWallet.callStatic.startDatePerToken(ETH)).to.equal(startDate);
      });
    });
  });

  describe('sendDust', () => {
    const ONE_ETH = toUnit(1);
    const TEN_DAIs = toUnit(10);

    it('should revert if the address is neither an ERC20 nor ETH', async () => {
      await expect(vestingWallet.connect(owner)['sendDust(address)'](vestingWallet.address)).to.be.revertedWith(
        "Transaction reverted: function selector was not recognized and there's no fallback function"
      );
    });

    it('should revert if transfer fails', async () => {
      await expect(vestingWallet.connect(owner)['sendDust(address)'](dai.address)).to.be.revertedWith(
        'SafeERC20: ERC20 operation did not succeed'
      );
    });

    context('when the function is called with the correct parameters', () => {
      beforeEach(async () => {
        await ethProvider.sendTransaction({
          to: vestingWallet.address,
          value: ONE_ETH,
        });
      });

      it('should transfer ETH successfully', async () => {
        const initialBalance = await owner.getBalance();
        const tx = await vestingWallet.connect(owner)['sendDust()']();

        const gasUsed = (await tx.wait()).gasUsed;
        const gasPrice = (await tx.wait()).effectiveGasPrice;
        const gasCost = gasUsed.mul(gasPrice).toNumber();

        const finalBalance = await owner.getBalance();

        expect(finalBalance.sub(initialBalance)).to.equal(ONE_ETH.sub(gasCost));
      });

      it('should emit an event if the transfer is successful', async () => {
        await expect(vestingWallet.connect(owner)['sendDust()']()).to.emit(vestingWallet, 'DustSent').withArgs(ETH, ONE_ETH, owner.address);
      });

      it('should call the transfer with the correct arguments', async () => {
        dai.transfer.returns(true);
        dai.balanceOf.returns(TEN_DAIs);
        await vestingWallet.connect(owner)['sendDust(address)'](dai.address);
        expect(dai.transfer).to.have.been.calledWith(owner.address, TEN_DAIs);
      });
    });
  });
});

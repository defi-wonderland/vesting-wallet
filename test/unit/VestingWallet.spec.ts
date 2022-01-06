import { IERC20 } from '@typechained';
import { toUnit } from '@utils/bn';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { ethers } from 'hardhat';
import { BigNumber, Transaction } from 'ethers';
import { VestingWallet, VestingWallet__factory } from '@typechained';
import { evm, wallet, behaviours } from '@utils';
import { DAI_ADDRESS, USDC_ADDRESS, DURATION, PARTIAL_DURATION, START_DATE, VEST_AMOUNT } from '@utils/constants';
import { FakeContract, MockContract, MockContractFactory, smock } from '@defi-wonderland/smock';
import chai, { expect } from 'chai';

chai.use(smock.matchers);

describe('VestingWallet', () => {
  let vestingWallet: MockContract<VestingWallet>;
  let vestingWalletFactory: MockContractFactory<VestingWallet__factory>;
  let snapshotId: string;
  let owner: SignerWithAddress;
  let dai: FakeContract<IERC20>;
  let usdc: FakeContract<IERC20>;

  const beneficiary = wallet.generateRandomAddress();

  before(async () => {
    [, owner] = await ethers.getSigners();
    vestingWalletFactory = await smock.mock<VestingWallet__factory>('VestingWallet');
    vestingWallet = await vestingWalletFactory.connect(owner).deploy(owner.address);
    dai = await smock.fake('ERC20', { address: DAI_ADDRESS });
    usdc = await smock.fake('ERC20', { address: USDC_ADDRESS });

    snapshotId = await evm.snapshot.take();
  });

  beforeEach(async () => {
    await evm.snapshot.revert(snapshotId);

    dai.transfer.reset();
    dai.transferFrom.reset();
  });

  after(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  describe('releasableAmount', () => {
    beforeEach(async () => {
      await vestingWallet.setVariable('benefits', {
        [DAI_ADDRESS]: {
          [beneficiary]: {
            ['amount']: VEST_AMOUNT,
            ['startDate']: START_DATE,
            ['duration']: DURATION,
          },
        },
      });

      await vestingWallet.setVariable('totalAmountPerToken', {
        [DAI_ADDRESS]: VEST_AMOUNT,
      });
    });

    it('should return 0 if vest has not yet started', async () => {
      await evm.advanceToTimeAndBlock(START_DATE - 1);
      expect(await vestingWallet.releasableAmount(beneficiary, DAI_ADDRESS)).to.be.eq(0);
    });

    it('should return total bonds if vest has finalized', async () => {
      await evm.advanceToTimeAndBlock(START_DATE + DURATION + 1);
      expect(await vestingWallet.releasableAmount(beneficiary, DAI_ADDRESS)).to.be.eq(VEST_AMOUNT);
    });

    it('should return a partial amount if vest is ongoing', async () => {
      await evm.advanceToTimeAndBlock(START_DATE + PARTIAL_DURATION);
      expect(await vestingWallet.releasableAmount(beneficiary, DAI_ADDRESS)).to.be.eq(VEST_AMOUNT.mul(PARTIAL_DURATION).div(DURATION));
    });

    it('should return 0 if claimable bonds has been released', async () => {
      dai.transfer.returns(true);

      await evm.advanceToTimeAndBlock(START_DATE + PARTIAL_DURATION);
      await vestingWallet['release(address,address)'](beneficiary, DAI_ADDRESS);
      expect(await vestingWallet.releasableAmount(beneficiary, DAI_ADDRESS)).to.be.eq(0);
    });
  });

  describe('addBenefit', () => {
    const RELEASE_DATE = START_DATE + DURATION;

    behaviours.onlyGovernance(
      () => vestingWallet,
      'addBenefit',
      () => [owner.address],
      [beneficiary, START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT]
    );

    it('should register the beneficiary if did not exist previously', async () => {
      expect(await vestingWallet.callStatic.isBeneficiary(beneficiary)).to.be.false;

      dai.transferFrom.returns(true);

      await vestingWallet.connect(owner).addBenefit(beneficiary, START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);

      expect(await vestingWallet.callStatic.isBeneficiary(beneficiary)).to.be.true;
    });

    context('when there was no previous benefit', () => {
      let tx: Transaction;

      beforeEach(async () => {
        dai.transferFrom.returns(true);

        tx = await vestingWallet.connect(owner).addBenefit(beneficiary, START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);
      });

      it('should transfer the token to the contract', async () => {
        expect(dai.transferFrom).to.be.calledOnce;
      });

      it('should update amount', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary)).amount).to.equal(VEST_AMOUNT);
      });

      it('should update releaseDate', async () => {
        expect(await vestingWallet.callStatic.releaseDate(beneficiary, DAI_ADDRESS)).to.equal(RELEASE_DATE);
      });

      it('should update startDate', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary)).startDate).to.equal(START_DATE);
      });

      // TODO: add events on other contexts
      it('should emit an event', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitAdded').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT, START_DATE, RELEASE_DATE);
      });
    });

    context('when there was a previous benefit', () => {
      const NEW_START_DATE = START_DATE * 10;

      beforeEach(async () => {
        dai.transfer.returns(true);
        dai.transferFrom.returns(true);

        await vestingWallet.setVariable('benefits', {
          [DAI_ADDRESS]: {
            [beneficiary]: {
              ['amount']: VEST_AMOUNT,
              ['startDate']: START_DATE,
              ['duration']: DURATION,
            },
          },
        });

        await vestingWallet.setVariable('totalAmountPerToken', {
          [DAI_ADDRESS]: VEST_AMOUNT,
        });
      });

      it('should overwrite start date', async () => {
        await vestingWallet.connect(owner).addBenefit(beneficiary, NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);

        expect((await vestingWallet.benefits(DAI_ADDRESS, beneficiary)).startDate).to.eq(NEW_START_DATE);
      });

      it('should overwrite release date', async () => {
        await vestingWallet.connect(owner).addBenefit(beneficiary, NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);

        expect(await vestingWallet.releaseDate(beneficiary, DAI_ADDRESS)).to.eq(NEW_START_DATE + DURATION);
      });

      context('when previous benefit has not yet started', () => {
        it('should add previous amount to new benefit', async () => {
          await vestingWallet.connect(owner).addBenefit(beneficiary, NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);

          expect((await vestingWallet.benefits(DAI_ADDRESS, beneficiary)).amount).to.eq(VEST_AMOUNT.mul(2));
        });
      });

      context('when previous benefit is ongoing', () => {
        const PARTIAL_PROPORTION = 3;
        let timestamp: number;
        let partialDuration: number;
        let partialBenefit: BigNumber;

        beforeEach(async () => {
          await evm.advanceToTimeAndBlock(START_DATE + DURATION / PARTIAL_PROPORTION);
          await vestingWallet.connect(owner).addBenefit(beneficiary, NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);
          // query latest block timestamp for precise calculation
          timestamp = (await ethers.provider.getBlock('latest')).timestamp;
          partialDuration = timestamp - START_DATE;
          partialBenefit = VEST_AMOUNT.mul(partialDuration).div(DURATION);
        });

        it('should release ongoing benefit', async () => {
          expect(dai.transfer).to.have.been.calledWith(beneficiary, partialBenefit);
        });

        it('should add remaining amount to new benefit', async () => {
          expect((await vestingWallet.benefits(DAI_ADDRESS, beneficiary)).amount).to.eq(VEST_AMOUNT.add(VEST_AMOUNT.sub(partialBenefit)));
        });
      });

      context('when previous benefit has ended', () => {
        beforeEach(async () => {
          await evm.advanceToTimeAndBlock(START_DATE + DURATION);
          await vestingWallet.connect(owner).addBenefit(beneficiary, NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);
        });

        it('should release all previous benefit', async () => {
          expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
        });

        it('should not add any amount to new benefit', async () => {
          expect((await vestingWallet.benefits(DAI_ADDRESS, beneficiary)).amount).to.eq(VEST_AMOUNT);
        });
      });
    });
  });

  describe('addBenefits', () => {
    const RELEASE_DATE = START_DATE + DURATION;
    const beneficiary1 = wallet.generateRandomAddress();
    const beneficiary2 = wallet.generateRandomAddress();
    const amount1 = VEST_AMOUNT.mul(3).div(4);
    const amount2 = VEST_AMOUNT.mul(1).div(4);
    const totalVestedAmount = VEST_AMOUNT;

    behaviours.onlyGovernance(
      () => vestingWallet,
      'addBenefits',
      () => [owner.address],
      [DAI_ADDRESS, [beneficiary1, beneficiary2], [amount1, amount2], START_DATE, DURATION]
    );

    context('when there was no previous benefit', () => {
      let tx: Transaction;

      beforeEach(async () => {
        dai.transferFrom.returns(true);

        tx = await vestingWallet.connect(owner).addBenefits(DAI_ADDRESS, [beneficiary1, beneficiary2], [amount1, amount2], START_DATE, DURATION);
      });

      it('should make 1 token transfer to the contract', async () => {
        expect(dai.transferFrom).to.be.calledOnceWith(owner.address, vestingWallet.address, totalVestedAmount);
      });

      it('should add benefits to total vested amount', async () => {
        expect(await vestingWallet.callStatic.totalAmountPerToken(DAI_ADDRESS)).to.be.eq(totalVestedAmount);
      });

      it('should update amounts', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary1)).amount).to.equal(amount1);
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary2)).amount).to.equal(amount2);
      });

      it('should update releaseDates', async () => {
        expect(await vestingWallet.callStatic.releaseDate(beneficiary1, DAI_ADDRESS)).to.equal(RELEASE_DATE);
        expect(await vestingWallet.callStatic.releaseDate(beneficiary2, DAI_ADDRESS)).to.equal(RELEASE_DATE);
      });

      it('should update startDates', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary1)).startDate).to.equal(START_DATE);
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary2)).startDate).to.equal(START_DATE);
      });

      // TODO: add events on other contexts
      it('should emit an event for each beneficiary', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitAdded').withArgs(DAI_ADDRESS, beneficiary1, amount1, START_DATE, RELEASE_DATE);
        await expect(tx).to.emit(vestingWallet, 'BenefitAdded').withArgs(DAI_ADDRESS, beneficiary2, amount2, START_DATE, RELEASE_DATE);
      });
    });

    context('when there was a previous benefit', () => {
      const NEW_START_DATE = START_DATE * 10;

      beforeEach(async () => {
        dai.transfer.returns(true);
        dai.transferFrom.returns(true);

        await vestingWallet.setVariable('benefits', {
          [DAI_ADDRESS]: {
            [beneficiary1]: {
              ['amount']: VEST_AMOUNT,
              ['startDate']: START_DATE,
              ['duration']: DURATION,
            },
          },
        });

        await vestingWallet.setVariable('totalAmountPerToken', {
          [DAI_ADDRESS]: VEST_AMOUNT,
        });
      });

      it('should overwrite start date', async () => {
        await vestingWallet.connect(owner).addBenefits(DAI_ADDRESS, [beneficiary1, beneficiary2], [amount1, amount2], NEW_START_DATE, DURATION);

        expect((await vestingWallet.benefits(DAI_ADDRESS, beneficiary1)).startDate).to.eq(NEW_START_DATE);
      });

      it('should overwrite release date', async () => {
        await vestingWallet.connect(owner).addBenefits(DAI_ADDRESS, [beneficiary1, beneficiary2], [amount1, amount2], NEW_START_DATE, DURATION);

        expect(await vestingWallet.releaseDate(beneficiary1, DAI_ADDRESS)).to.eq(NEW_START_DATE + DURATION);
      });

      context('when previous benefit has not yet started', () => {
        it('should add previous amount to new benefit', async () => {
          await vestingWallet
            .connect(owner)
            .addBenefits(DAI_ADDRESS, [beneficiary1, beneficiary2], [amount1, amount2], NEW_START_DATE, DURATION);

          expect((await vestingWallet.benefits(DAI_ADDRESS, beneficiary1)).amount).to.eq(VEST_AMOUNT.add(amount1));
        });
      });

      context('when previous benefit is ongoing', () => {
        const PARTIAL_PROPORTION = 3;
        let timestamp: number;
        let partialDuration: number;
        let partialBenefit: BigNumber;

        beforeEach(async () => {
          await evm.advanceToTimeAndBlock(START_DATE + DURATION / PARTIAL_PROPORTION);
          await vestingWallet
            .connect(owner)
            .addBenefits(DAI_ADDRESS, [beneficiary1, beneficiary2], [amount1, amount2], NEW_START_DATE, DURATION);

          // query latest block timestamp for precise calculation
          timestamp = (await ethers.provider.getBlock('latest')).timestamp;
          partialDuration = timestamp - START_DATE;
          partialBenefit = VEST_AMOUNT.mul(partialDuration).div(DURATION);
        });

        it('should release ongoing benefit', async () => {
          expect(dai.transfer).to.have.been.calledWith(beneficiary1, partialBenefit);
        });

        it('should add remaining amount to new benefit', async () => {
          const expectedAmount = VEST_AMOUNT.sub(partialBenefit).add(amount1);
          expect((await vestingWallet.benefits(DAI_ADDRESS, beneficiary1)).amount).to.eq(expectedAmount);
        });
      });

      context('when previous benefit has ended', () => {
        beforeEach(async () => {
          await evm.advanceToTimeAndBlock(START_DATE + DURATION);
          await vestingWallet
            .connect(owner)
            .addBenefits(DAI_ADDRESS, [beneficiary1, beneficiary2], [amount1, amount2], NEW_START_DATE, DURATION);
        });

        it('should release all previous benefit', async () => {
          expect(dai.transfer).to.have.been.calledWith(beneficiary1, VEST_AMOUNT);
        });

        it('should not add any amount to new benefit', async () => {
          expect((await vestingWallet.benefits(DAI_ADDRESS, beneficiary1)).amount).to.eq(amount1);
        });
      });
    });
  });

  describe('removeBenefit', () => {
    behaviours.onlyGovernance(
      () => vestingWallet,
      'removeBenefit',
      () => [owner.address],
      [beneficiary, DAI_ADDRESS]
    );

    beforeEach(async () => {
      await vestingWallet.setVariable('benefits', {
        [DAI_ADDRESS]: {
          [beneficiary]: {
            ['amount']: VEST_AMOUNT,
            ['startDate']: START_DATE,
            ['duration']: DURATION,
          },
        },
      });

      await vestingWallet.setVariable('totalAmountPerToken', {
        [DAI_ADDRESS]: VEST_AMOUNT,
      });
    });

    it('should revert if transfer fails', async () => {
      dai.transfer.reverts();

      await expect(vestingWallet.connect(owner).removeBenefit(beneficiary, DAI_ADDRESS)).to.be.revertedWith('SafeERC20: low-level call failed');
    });

    it('should revert if transfer does not succeed', async () => {
      dai.transfer.returns(false);

      await expect(vestingWallet.connect(owner).removeBenefit(beneficiary, DAI_ADDRESS)).to.be.revertedWith(
        'SafeERC20: ERC20 operation did not succeed'
      );
    });

    context('when vesting period has not yet started', () => {
      beforeEach(async () => {
        dai.transfer.returns(true);

        await evm.advanceToTime(START_DATE - 1);
      });

      it('should transfer all vested tokens to owner', async () => {
        await vestingWallet.connect(owner).removeBenefit(beneficiary, DAI_ADDRESS);
        expect(dai.transfer).to.have.been.calledWith(owner.address, VEST_AMOUNT);
      });

      it('should emit an event', async () => {
        await expect(await vestingWallet.connect(owner).removeBenefit(beneficiary, DAI_ADDRESS))
          .to.emit(vestingWallet, 'BenefitRemoved')
          .withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
      });
    });

    context('when vesting period is ongoing', () => {
      const DENOMINATOR = 3;
      let timestamp: number;
      let partialDuration: number;

      beforeEach(async () => {
        dai.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);
        await vestingWallet.connect(owner).removeBenefit(beneficiary, DAI_ADDRESS);

        // query latest block timestamp for precise calculation
        timestamp = (await ethers.provider.getBlock('latest')).timestamp;
        partialDuration = timestamp - START_DATE;
      });

      it('should transfer releaseable ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT.mul(partialDuration).div(DURATION));
      });

      it('should transfer remaining ERC20 amount to owner', async () => {
        expect(dai.transfer).to.have.been.calledWith(owner.address, VEST_AMOUNT.sub(VEST_AMOUNT.mul(partialDuration).div(DURATION)));
      });
    });

    context('when vesting period has ended', () => {
      beforeEach(async () => {
        dai.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION);
        await vestingWallet.connect(owner).removeBenefit(beneficiary, DAI_ADDRESS);
      });

      it('should transfer total ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
      });
    });
  });

  describe('sendDust', () => {
    const TEN_DAIs = toUnit(10);

    behaviours.onlyGovernance(
      () => vestingWallet,
      'sendDust',
      () => [owner.address],
      [DAI_ADDRESS]
    );

    it('should revert if the address is neither an ERC20 nor ETH', async () => {
      await expect(vestingWallet.connect(owner).sendDust(wallet.generateRandomAddress())).to.be.reverted;
    });

    it('should revert if transfer fails', async () => {
      dai.transfer.returns(false);

      await expect(vestingWallet.connect(owner).sendDust(DAI_ADDRESS)).to.be.revertedWith('SafeERC20: ERC20 operation did not succeed');
    });

    it('should call the transfer with the correct arguments', async () => {
      dai.transfer.returns(true);
      dai.balanceOf.returns(TEN_DAIs);
      await vestingWallet.connect(owner).sendDust(DAI_ADDRESS);
      expect(dai.transfer).to.have.been.calledWith(owner.address, TEN_DAIs);
    });

    it('should emit an event', async () => {
      dai.transfer.returns(true);

      await expect(vestingWallet.connect(owner).sendDust(DAI_ADDRESS))
        .to.emit(vestingWallet, 'DustSent')
        .withArgs(DAI_ADDRESS, TEN_DAIs, owner.address);
    });
  });

  describe('release(address,address)', () => {
    const DENOMINATOR = 3;
    let tx: Transaction;

    beforeEach(async () => {
      await vestingWallet.setVariable('benefits', {
        [DAI_ADDRESS]: {
          [beneficiary]: {
            ['amount']: VEST_AMOUNT,
            ['startDate']: START_DATE,
            ['duration']: DURATION,
          },
        },
      });

      await vestingWallet.setVariable('totalAmountPerToken', {
        [DAI_ADDRESS]: VEST_AMOUNT,
      });
    });

    it('should revert if transfer fails', async () => {
      dai.transfer.reverts();
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(owner)['release(address,address)'](beneficiary, DAI_ADDRESS)).to.be.revertedWith(
        'SafeERC20: low-level call failed'
      );
    });

    it('should revert if transfer does not succeed', async () => {
      dai.transfer.returns(false);
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(owner)['release(address,address)'](beneficiary, DAI_ADDRESS)).to.be.revertedWith(
        'SafeERC20: ERC20 operation did not succeed'
      );
    });

    context('when vesting period has not yet started', () => {
      beforeEach(async () => {
        await evm.advanceToTime(START_DATE - 1);
      });

      it('should not do any transfer', async () => {
        await vestingWallet.connect(owner)['release(address,address)'](beneficiary, DAI_ADDRESS);
        expect(dai.transfer).to.not.have.been.called;
      });

      it('should not emit the BenefitReleased event', async () => {
        await expect(vestingWallet.connect(owner)['release(address,address)'](beneficiary, DAI_ADDRESS)).to.not.emit(
          vestingWallet,
          'BenefitReleased'
        );
      });
    });

    context('when vesting period is ongoing', () => {
      let timestamp: number;
      let partialDuration: number;
      let releaseableAmount: BigNumber;

      beforeEach(async () => {
        dai.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);
        tx = await vestingWallet.connect(owner)['release(address,address)'](beneficiary, DAI_ADDRESS);

        // query latest block timestamp for precise calculation
        timestamp = (await ethers.provider.getBlock('latest')).timestamp;
        partialDuration = timestamp - START_DATE;

        releaseableAmount = VEST_AMOUNT.mul(partialDuration).div(DURATION);
      });

      it('should transfer releaseable ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, releaseableAmount);
      });

      it('should emit the BenefitReleased event', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, releaseableAmount);
      });
    });

    context('when vesting period has ended', () => {
      beforeEach(async () => {
        dai.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION);
        tx = await vestingWallet.connect(owner)['release(address,address)'](beneficiary, DAI_ADDRESS);
      });

      it('should transfer total ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
      });

      it('should emit the BenefitReleased event', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
      });
    });
  });

  describe('release(address,address[])', () => {
    const DENOMINATOR = 3;
    // setting a 2nd vest that starts before and ends at the same time
    const START_DATE_USDC = START_DATE - DURATION;
    const DURATION_USDC = DURATION * 2;
    let tx: Transaction;

    beforeEach(async () => {
      await vestingWallet.setVariable('benefits', {
        [DAI_ADDRESS]: {
          [beneficiary]: {
            ['amount']: VEST_AMOUNT,
            ['startDate']: START_DATE,
            ['duration']: DURATION,
          },
        },
        [USDC_ADDRESS]: {
          [beneficiary]: {
            ['amount']: VEST_AMOUNT,
            ['startDate']: START_DATE_USDC,
            ['duration']: DURATION_USDC,
          },
        },
      });

      await vestingWallet.setVariable('totalAmountPerToken', {
        [DAI_ADDRESS]: VEST_AMOUNT,
        [USDC_ADDRESS]: VEST_AMOUNT,
      });
    });

    it('should revert if one transfer fails', async () => {
      dai.transfer.reverts();
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(owner)['release(address,address[])'](beneficiary, [DAI_ADDRESS, USDC_ADDRESS])).to.be.revertedWith(
        'SafeERC20: low-level call failed'
      );
    });

    it('should revert if one transfer does not succeed', async () => {
      dai.transfer.returns(false);
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(owner)['release(address,address[])'](beneficiary, [DAI_ADDRESS, USDC_ADDRESS])).to.be.revertedWith(
        'SafeERC20: ERC20 operation did not succeed'
      );
    });

    context('when none of the vesting periods has yet started', () => {
      beforeEach(async () => {
        await evm.advanceToTime(START_DATE - DURATION);
      });

      it('should not do any transfer', async () => {
        await vestingWallet.connect(owner)['release(address,address[])'](beneficiary, [DAI_ADDRESS, USDC_ADDRESS]);
        expect(dai.transfer).to.not.have.been.called;
        expect(usdc.transfer).to.not.have.been.called;
      });

      it('should not emit the BenefitReleased event', async () => {
        await expect(vestingWallet.connect(owner)['release(address,address[])'](beneficiary, [DAI_ADDRESS, USDC_ADDRESS])).to.not.emit(
          vestingWallet,
          'BenefitReleased'
        );
      });
    });

    context('when one of vesting period is ongoing', () => {
      let timestamp: number;
      let partialDurationUsdc: number;
      let partialReleasedUsdc: BigNumber;

      beforeEach(async () => {
        usdc.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE - 1);
        tx = await vestingWallet.connect(owner)['release(address,address[])'](beneficiary, [DAI_ADDRESS, USDC_ADDRESS]);

        // query latest block timestamp for precise calculation
        timestamp = (await ethers.provider.getBlock('latest')).timestamp;
        partialDurationUsdc = timestamp - START_DATE_USDC;

        partialReleasedUsdc = VEST_AMOUNT.mul(partialDurationUsdc).div(DURATION_USDC);
      });

      it('should transfer releaseable ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).not.to.have.been.called;
        expect(usdc.transfer).to.have.been.calledWith(beneficiary, partialReleasedUsdc);
      });

      it('should emit one BenefitReleased event', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, partialReleasedUsdc);
      });
    });

    context('when both of vesting period are ongoing', () => {
      let timestamp: number;
      let partialDurationDai: number;
      let partialDurationUsdc: number;
      let partialReleasedDai: BigNumber;
      let partialReleasedUsdc: BigNumber;

      beforeEach(async () => {
        dai.transfer.returns(true);
        usdc.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);
        tx = await vestingWallet.connect(owner)['release(address,address[])'](beneficiary, [DAI_ADDRESS, USDC_ADDRESS]);

        // query latest block timestamp for precise calculation
        timestamp = (await ethers.provider.getBlock('latest')).timestamp;
        partialDurationDai = timestamp - START_DATE;
        partialDurationUsdc = timestamp - START_DATE_USDC;

        partialReleasedDai = VEST_AMOUNT.mul(partialDurationDai).div(DURATION);
        partialReleasedUsdc = VEST_AMOUNT.mul(partialDurationUsdc).div(DURATION_USDC);
      });

      it('should transfer both releaseable ERC20 amounts to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, partialReleasedDai);
        expect(usdc.transfer).to.have.been.calledWith(beneficiary, partialReleasedUsdc);
      });

      it('should emit both BenefitReleased events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, partialReleasedDai);
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, partialReleasedUsdc);
      });
    });

    context('when vesting periods have ended', () => {
      beforeEach(async () => {
        dai.transfer.returns(true);
        usdc.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION);
        tx = await vestingWallet.connect(owner)['release(address,address[])'](beneficiary, [DAI_ADDRESS, USDC_ADDRESS]);
      });

      it('should transfer both total ERC20 amounts to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
        expect(usdc.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
      });

      it('should emit both BenefitReleased events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, VEST_AMOUNT);
      });
    });
  });
});

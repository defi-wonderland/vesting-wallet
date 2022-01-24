import { JsonRpcSigner } from '@ethersproject/providers';
import { toUnit } from '@utils/bn';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { ethers } from 'hardhat';
import { BigNumber, Transaction } from 'ethers';
import { IERC20, VestingWalletForTest, VestingWalletForTest__factory } from '@typechained';
import { evm, wallet, behaviours } from '@utils';
import { DAI_ADDRESS, USDC_ADDRESS, DURATION, PARTIAL_DURATION, START_DATE, VEST_AMOUNT } from '@utils/constants';
import { FakeContract, MockContract, MockContractFactory, smock } from '@defi-wonderland/smock';
import chai, { expect } from 'chai';

chai.use(smock.matchers);

describe('VestingWallet', () => {
  let vestingWallet: MockContract<VestingWalletForTest>;
  let vestingWalletFactory: MockContractFactory<VestingWalletForTest__factory>;
  let snapshotId: string;
  let owner: SignerWithAddress;
  let dai: FakeContract<IERC20>;
  let usdc: FakeContract<IERC20>;

  const beneficiary = wallet.generateRandomAddress();
  const anotherBeneficiary = wallet.generateRandomAddress();

  before(async () => {
    [, owner] = await ethers.getSigners();
    vestingWalletFactory = await smock.mock<VestingWalletForTest__factory>('VestingWalletForTest');
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
      expect(await vestingWallet.releasableAmount(DAI_ADDRESS, beneficiary)).to.be.eq(0);
    });

    it('should return total bonds if vest has finalized', async () => {
      await evm.advanceToTimeAndBlock(START_DATE + DURATION + 1);
      expect(await vestingWallet.releasableAmount(DAI_ADDRESS, beneficiary)).to.be.eq(VEST_AMOUNT);
    });

    it('should return a partial amount if vest is ongoing', async () => {
      await evm.advanceToTimeAndBlock(START_DATE + PARTIAL_DURATION);
      expect(await vestingWallet.releasableAmount(DAI_ADDRESS, beneficiary)).to.be.eq(VEST_AMOUNT.mul(PARTIAL_DURATION).div(DURATION));
    });

    it('should return 0 if claimable bonds has been released', async () => {
      dai.transfer.returns(true);

      await evm.advanceToTimeAndBlock(START_DATE + PARTIAL_DURATION);
      await vestingWallet['release(address,address)'](DAI_ADDRESS, beneficiary);
      expect(await vestingWallet.releasableAmount(DAI_ADDRESS, beneficiary)).to.be.eq(0);
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

    context('when there was no previous benefit', () => {
      let tx: Transaction;

      beforeEach(async () => {
        dai.transferFrom.returns(true);

        tx = await vestingWallet.connect(owner).addBenefit(beneficiary, START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);
      });

      it('should register the beneficiary', async () => {
        expect(await vestingWallet.callStatic.getBeneficiaries()).to.include(beneficiary);
      });

      it('should register the token', async () => {
        expect(await vestingWallet.callStatic.getTokens()).to.include(DAI_ADDRESS);
      });

      it('should add the token to the beneficiary list of tokens', async () => {
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary)).to.include(DAI_ADDRESS);
      });

      it('should transfer the token to the contract', async () => {
        expect(dai.transferFrom).to.be.calledOnce;
      });

      it('should update amount', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary)).amount).to.equal(VEST_AMOUNT);
      });

      it('should update releaseDate', async () => {
        expect(await vestingWallet.callStatic.releaseDate(DAI_ADDRESS, beneficiary)).to.equal(RELEASE_DATE);
      });

      it('should update startDate', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary)).startDate).to.equal(START_DATE);
      });

      it('should update startDate', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary)).startDate).to.equal(START_DATE);
      });

      it('should emit event', async () => {
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

        await vestingWallet.addTokenToBeneficiaryForTest(DAI_ADDRESS, beneficiary);
      });

      it('should overwrite start date', async () => {
        await vestingWallet.connect(owner).addBenefit(beneficiary, NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);

        expect((await vestingWallet.benefits(DAI_ADDRESS, beneficiary)).startDate).to.eq(NEW_START_DATE);
      });

      it('should overwrite release date', async () => {
        await vestingWallet.connect(owner).addBenefit(beneficiary, NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);

        expect(await vestingWallet.releaseDate(DAI_ADDRESS, beneficiary)).to.eq(NEW_START_DATE + DURATION);
      });

      context('when previous benefit has not yet started', () => {
        let tx: Transaction;

        beforeEach(async () => {
          tx = await vestingWallet.connect(owner).addBenefit(beneficiary, NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);
        });

        it('should add previous amount to new benefit', async () => {
          expect((await vestingWallet.benefits(DAI_ADDRESS, beneficiary)).amount).to.eq(VEST_AMOUNT.mul(2));
        });

        it('should emit event', async () => {
          await expect(tx).not.emit(vestingWallet, 'BenefitReleased');
          await expect(tx)
            .to.emit(vestingWallet, 'BenefitAdded')
            .withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT.mul(2), NEW_START_DATE, NEW_START_DATE + DURATION);
        });
      });

      context('when previous benefit is ongoing', () => {
        const PARTIAL_PROPORTION = 3;
        let timestamp: number;
        let partialDuration: number;
        let partialBenefit: BigNumber;
        let newBenefit: BigNumber;
        let tx: Transaction;

        beforeEach(async () => {
          await evm.advanceToTimeAndBlock(START_DATE + DURATION / PARTIAL_PROPORTION);
          tx = await vestingWallet.connect(owner).addBenefit(beneficiary, NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);
          // query latest block timestamp for precise calculation
          timestamp = (await ethers.provider.getBlock('latest')).timestamp;
          partialDuration = timestamp - START_DATE;
          partialBenefit = VEST_AMOUNT.mul(partialDuration).div(DURATION);
          newBenefit = VEST_AMOUNT.add(VEST_AMOUNT.sub(partialBenefit));
        });

        it('should release ongoing benefit', async () => {
          expect(dai.transfer).to.have.been.calledWith(beneficiary, partialBenefit);
        });

        it('should add remaining amount to new benefit', async () => {
          expect((await vestingWallet.benefits(DAI_ADDRESS, beneficiary)).amount).to.eq(newBenefit);
        });

        it('should emit events', async () => {
          await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, partialBenefit);
          await expect(tx)
            .to.emit(vestingWallet, 'BenefitAdded')
            .withArgs(DAI_ADDRESS, beneficiary, newBenefit, NEW_START_DATE, NEW_START_DATE + DURATION);
        });
      });

      context('when previous benefit has ended', () => {
        let tx: Transaction;

        beforeEach(async () => {
          await evm.advanceToTimeAndBlock(START_DATE + DURATION);
          tx = await vestingWallet.connect(owner).addBenefit(beneficiary, NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);
        });

        it('should release all previous benefit', async () => {
          expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
        });

        it('should not add any amount to new benefit', async () => {
          expect((await vestingWallet.benefits(DAI_ADDRESS, beneficiary)).amount).to.eq(VEST_AMOUNT);
        });

        it('should not delete token from beneficiary-token list', async () => {
          expect(await vestingWallet.getTokensOf(beneficiary)).to.include(DAI_ADDRESS);
        });

        it('should emit events', async () => {
          await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
          await expect(tx)
            .to.emit(vestingWallet, 'BenefitAdded')
            .withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT, NEW_START_DATE, NEW_START_DATE + DURATION);
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

      it('should register the beneficiaries', async () => {
        expect(await vestingWallet.callStatic.getBeneficiaries()).to.include(beneficiary1, beneficiary2);
      });

      it('should register the token', async () => {
        expect(await vestingWallet.callStatic.getTokens()).to.include(DAI_ADDRESS);
      });

      it('should add the token to the beneficiaries list of tokens', async () => {
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary1)).to.include(DAI_ADDRESS);
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary2)).to.include(DAI_ADDRESS);
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
        expect(await vestingWallet.callStatic.releaseDate(DAI_ADDRESS, beneficiary1)).to.equal(RELEASE_DATE);
        expect(await vestingWallet.callStatic.releaseDate(DAI_ADDRESS, beneficiary2)).to.equal(RELEASE_DATE);
      });

      it('should update startDates', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary1)).startDate).to.equal(START_DATE);
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary2)).startDate).to.equal(START_DATE);
      });

      it('should emit events', async () => {
        await expect(tx).not.emit(vestingWallet, 'BenefitReleased');
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

        await vestingWallet.addTokenToBeneficiaryForTest(DAI_ADDRESS, beneficiary1);
      });

      it('should overwrite start date', async () => {
        await vestingWallet.connect(owner).addBenefits(DAI_ADDRESS, [beneficiary1, beneficiary2], [amount1, amount2], NEW_START_DATE, DURATION);

        expect((await vestingWallet.benefits(DAI_ADDRESS, beneficiary1)).startDate).to.eq(NEW_START_DATE);
      });

      it('should overwrite release date', async () => {
        await vestingWallet.connect(owner).addBenefits(DAI_ADDRESS, [beneficiary1, beneficiary2], [amount1, amount2], NEW_START_DATE, DURATION);

        expect(await vestingWallet.releaseDate(DAI_ADDRESS, beneficiary1)).to.eq(NEW_START_DATE + DURATION);
      });

      context('when previous benefit has not yet started', () => {
        let tx: Transaction;

        beforeEach(async () => {
          tx = await vestingWallet
            .connect(owner)
            .addBenefits(DAI_ADDRESS, [beneficiary1, beneficiary2], [amount1, amount2], NEW_START_DATE, DURATION);
        });

        it('should add previous amount to new benefit', async () => {
          expect((await vestingWallet.benefits(DAI_ADDRESS, beneficiary1)).amount).to.eq(VEST_AMOUNT.add(amount1));
        });

        it('should emit events', async () => {
          await expect(tx).not.emit(vestingWallet, 'BenefitReleased');
          await expect(tx)
            .to.emit(vestingWallet, 'BenefitAdded')
            .withArgs(DAI_ADDRESS, beneficiary1, VEST_AMOUNT.add(amount1), NEW_START_DATE, NEW_START_DATE + DURATION);
          await expect(tx)
            .to.emit(vestingWallet, 'BenefitAdded')
            .withArgs(DAI_ADDRESS, beneficiary2, amount2, NEW_START_DATE, NEW_START_DATE + DURATION);
        });
      });

      context('when previous benefit is ongoing', () => {
        const PARTIAL_PROPORTION = 3;
        let timestamp: number;
        let partialDuration: number;
        let partialBenefit: BigNumber;
        let newBenefit: BigNumber;
        let tx: Transaction;

        beforeEach(async () => {
          await evm.advanceToTimeAndBlock(START_DATE + DURATION / PARTIAL_PROPORTION);
          tx = await vestingWallet
            .connect(owner)
            .addBenefits(DAI_ADDRESS, [beneficiary1, beneficiary2], [amount1, amount2], NEW_START_DATE, DURATION);

          // query latest block timestamp for precise calculation
          timestamp = (await ethers.provider.getBlock('latest')).timestamp;
          partialDuration = timestamp - START_DATE;
          partialBenefit = VEST_AMOUNT.mul(partialDuration).div(DURATION);
          newBenefit = VEST_AMOUNT.sub(partialBenefit).add(amount1);
        });

        it('should release ongoing benefit', async () => {
          expect(dai.transfer).to.have.been.calledWith(beneficiary1, partialBenefit);
        });

        it('should add remaining amount to new benefit', async () => {
          const amount = (await vestingWallet.benefits(DAI_ADDRESS, beneficiary1)).amount;
          expect(amount).to.eq(newBenefit);
        });

        it('should emit events', async () => {
          await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary1, partialBenefit);
          await expect(tx)
            .to.emit(vestingWallet, 'BenefitAdded')
            .withArgs(DAI_ADDRESS, beneficiary1, newBenefit, NEW_START_DATE, NEW_START_DATE + DURATION);
          await expect(tx)
            .to.emit(vestingWallet, 'BenefitAdded')
            .withArgs(DAI_ADDRESS, beneficiary2, amount2, NEW_START_DATE, NEW_START_DATE + DURATION);
        });
      });

      context('when previous benefit has ended', () => {
        let tx: Transaction;
        beforeEach(async () => {
          await evm.advanceToTimeAndBlock(START_DATE + DURATION);
          tx = await vestingWallet
            .connect(owner)
            .addBenefits(DAI_ADDRESS, [beneficiary1, beneficiary2], [amount1, amount2], NEW_START_DATE, DURATION);
        });

        it('should release all previous benefit', async () => {
          expect(dai.transfer).to.have.been.calledWith(beneficiary1, VEST_AMOUNT);
        });

        it('should not add any amount to new benefit', async () => {
          expect((await vestingWallet.benefits(DAI_ADDRESS, beneficiary1)).amount).to.eq(amount1);
        });

        it('should emit events', async () => {
          await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary1, VEST_AMOUNT);
          await expect(tx)
            .to.emit(vestingWallet, 'BenefitAdded')
            .withArgs(DAI_ADDRESS, beneficiary1, amount1, NEW_START_DATE, NEW_START_DATE + DURATION);
          await expect(tx)
            .to.emit(vestingWallet, 'BenefitAdded')
            .withArgs(DAI_ADDRESS, beneficiary2, amount2, NEW_START_DATE, NEW_START_DATE + DURATION);
        });
      });
    });
  });

  describe('removeBenefit', () => {
    behaviours.onlyGovernance(
      () => vestingWallet,
      'removeBenefit',
      () => [owner.address],
      [DAI_ADDRESS, beneficiary]
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

      await vestingWallet.addBeneficiaryForTest(beneficiary);

      await vestingWallet.addTokenForTest(DAI_ADDRESS);

      await vestingWallet.addTokenToBeneficiaryForTest(DAI_ADDRESS, beneficiary);
    });

    it('should revert if transfer fails', async () => {
      dai.transfer.reverts();

      await expect(vestingWallet.connect(owner).removeBenefit(DAI_ADDRESS, beneficiary)).to.be.revertedWith('SafeERC20: low-level call failed');
    });

    it('should revert if transfer does not succeed', async () => {
      dai.transfer.returns(false);

      await expect(vestingWallet.connect(owner).removeBenefit(DAI_ADDRESS, beneficiary)).to.be.revertedWith(
        'SafeERC20: ERC20 operation did not succeed'
      );
    });

    context('when vesting period has not yet started', () => {
      beforeEach(async () => {
        dai.transfer.returns(true);

        await evm.advanceToTime(START_DATE - 1);
      });

      it('should transfer all vested tokens to owner', async () => {
        await vestingWallet.connect(owner).removeBenefit(DAI_ADDRESS, beneficiary);
        expect(dai.transfer).to.have.been.calledWith(owner.address, VEST_AMOUNT);
      });

      it('should emit event', async () => {
        expect(await vestingWallet.connect(owner).removeBenefit(DAI_ADDRESS, beneficiary))
          .to.emit(vestingWallet, 'BenefitRemoved')
          .withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
      });
    });

    context('when vesting period is ongoing', () => {
      const DENOMINATOR = 3;
      let timestamp: number;
      let partialDuration: number;
      let partialBenefit: BigNumber;
      let tx: Transaction;

      beforeEach(async () => {
        dai.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);
        tx = await vestingWallet.connect(owner).removeBenefit(DAI_ADDRESS, beneficiary);

        // query latest block timestamp for precise calculation
        timestamp = (await ethers.provider.getBlock('latest')).timestamp;
        partialDuration = timestamp - START_DATE;
        partialBenefit = VEST_AMOUNT.mul(partialDuration).div(DURATION);
      });

      it('should transfer releaseable ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, partialBenefit);
      });

      it('should transfer remaining ERC20 amount to owner', async () => {
        expect(dai.transfer).to.have.been.calledWith(owner.address, VEST_AMOUNT.sub(partialBenefit));
      });

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, partialBenefit);
        await expect(tx).to.emit(vestingWallet, 'BenefitRemoved').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT.sub(partialBenefit));
      });
    });

    context('when vesting period has ended', () => {
      let tx: Transaction;

      beforeEach(async () => {
        dai.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION);
        tx = await vestingWallet.connect(owner).removeBenefit(DAI_ADDRESS, beneficiary);
      });

      it('should transfer total ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
      });

      it('should delete the benefit', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary)).startDate).to.be.equal(0);
      });

      it('should remove the beneficiary from the beneficiaries list', async () => {
        expect(await vestingWallet.callStatic.getBeneficiaries()).to.not.include(beneficiary);
      });

      it('should remove the token from beneficiary-token list', async () => {
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary)).to.not.include(DAI_ADDRESS);
      });

      it('should remove the token if it has not more beneficiaries', async () => {
        expect(await vestingWallet.callStatic.getTokens()).to.not.include(DAI_ADDRESS);
      });

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
        await expect(tx).to.emit(vestingWallet, 'BenefitRemoved').withArgs(DAI_ADDRESS, beneficiary, 0);
      });
    });
  });

  describe('removeBeneficiary', () => {
    behaviours.onlyGovernance(
      () => vestingWallet,
      'removeBeneficiary',
      () => [owner.address],
      [beneficiary]
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
        [USDC_ADDRESS]: {
          [beneficiary]: {
            ['amount']: VEST_AMOUNT,
            ['startDate']: START_DATE,
            ['duration']: DURATION,
          },
        },
      });

      await vestingWallet.setVariable('totalAmountPerToken', {
        [DAI_ADDRESS]: VEST_AMOUNT,
        [USDC_ADDRESS]: VEST_AMOUNT,
      });

      await vestingWallet.addBeneficiaryForTest(beneficiary);

      await vestingWallet.addTokenForTest(DAI_ADDRESS);
      await vestingWallet.addTokenForTest(USDC_ADDRESS);

      await vestingWallet.addTokenToBeneficiaryForTest(DAI_ADDRESS, beneficiary);
      await vestingWallet.addTokenToBeneficiaryForTest(USDC_ADDRESS, beneficiary);
    });

    context('when vesting period has not yet started', () => {
      let tx: Transaction;

      beforeEach(async () => {
        dai.transfer.returns(true);
        usdc.transfer.returns(true);

        await evm.advanceToTime(START_DATE - 1);
        tx = await vestingWallet.connect(owner).removeBeneficiary(beneficiary);
      });

      it('should transfer all vested tokens to owner', async () => {
        expect(dai.transfer).to.have.been.calledWith(owner.address, VEST_AMOUNT);
        expect(usdc.transfer).to.have.been.calledWith(owner.address, VEST_AMOUNT);
      });

      it('should delete all beneficiary benefits', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary)).startDate).to.be.equal(0);
        expect((await vestingWallet.callStatic.benefits(USDC_ADDRESS, beneficiary)).startDate).to.be.equal(0);
      });

      it('should remove the beneficiary from the beneficiaries list', async () => {
        expect(await vestingWallet.callStatic.getBeneficiaries()).to.not.include(beneficiary);
      });

      it('should remove the token from beneficiary-token list', async () => {
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary)).to.not.include(DAI_ADDRESS);
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary)).to.not.include(USDC_ADDRESS);
      });

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitRemoved').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);

        await expect(tx).to.emit(vestingWallet, 'BenefitRemoved').withArgs(USDC_ADDRESS, beneficiary, VEST_AMOUNT);
      });
    });

    context('when vesting period is ongoing', () => {
      const DENOMINATOR = 3;
      let timestamp: number;
      let partialDuration: number;
      let partialBenefit: BigNumber;
      let tx: Transaction;

      beforeEach(async () => {
        dai.transfer.returns(true);
        usdc.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);
        tx = await vestingWallet.connect(owner).removeBeneficiary(beneficiary);

        // query latest block timestamp for precise calculation
        timestamp = (await ethers.provider.getBlock('latest')).timestamp;
        partialDuration = timestamp - START_DATE;
        partialBenefit = VEST_AMOUNT.mul(partialDuration).div(DURATION);
      });

      it('should transfer releaseable ERC20s amounts to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, partialBenefit);
        expect(usdc.transfer).to.have.been.calledWith(beneficiary, partialBenefit);
      });

      it('should transfer remaining ERC20s amounts to owner', async () => {
        expect(dai.transfer).to.have.been.calledWith(owner.address, VEST_AMOUNT.sub(partialBenefit));
        expect(usdc.transfer).to.have.been.calledWith(owner.address, VEST_AMOUNT.sub(partialBenefit));
      });

      it('should delete all beneficiary benefits', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary)).startDate).to.be.equal(0);
        expect((await vestingWallet.callStatic.benefits(USDC_ADDRESS, beneficiary)).startDate).to.be.equal(0);
      });

      it('should remove the beneficiary from the beneficiaries list', async () => {
        expect(await vestingWallet.callStatic.getBeneficiaries()).to.not.include(beneficiary);
      });

      it('should remove the token from beneficiary-token list', async () => {
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary)).to.not.include(DAI_ADDRESS);
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary)).to.not.include(USDC_ADDRESS);
      });

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, partialBenefit);
        await expect(tx).to.emit(vestingWallet, 'BenefitRemoved').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT.sub(partialBenefit));
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, partialBenefit);
        await expect(tx).to.emit(vestingWallet, 'BenefitRemoved').withArgs(USDC_ADDRESS, beneficiary, VEST_AMOUNT.sub(partialBenefit));
      });
    });

    context('when vesting period has ended', () => {
      let tx: Transaction;

      beforeEach(async () => {
        dai.transfer.returns(true);
        usdc.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION);
        tx = await vestingWallet.connect(owner).removeBeneficiary(beneficiary);
      });

      it('should transfer total ERC20s amounts to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
        expect(usdc.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
      });

      it('should delete all beneficiary benefits', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary)).startDate).to.be.equal(0);
        expect((await vestingWallet.callStatic.benefits(USDC_ADDRESS, beneficiary)).startDate).to.be.equal(0);
      });

      it('should remove the beneficiary from the beneficiaries list', async () => {
        expect(await vestingWallet.callStatic.getBeneficiaries()).to.not.include(beneficiary);
      });

      it('should remove the token from beneficiary-token list', async () => {
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary)).to.not.include(DAI_ADDRESS);
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary)).to.not.include(USDC_ADDRESS);
      });

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
        await expect(tx).to.emit(vestingWallet, 'BenefitRemoved').withArgs(DAI_ADDRESS, beneficiary, 0);
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, VEST_AMOUNT);
        await expect(tx).to.emit(vestingWallet, 'BenefitRemoved').withArgs(USDC_ADDRESS, beneficiary, 0);
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

    it('should emit event', async () => {
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
          [anotherBeneficiary]: {
            ['amount']: VEST_AMOUNT,
            ['startDate']: START_DATE,
            ['duration']: DURATION,
          },
        },
      });
      await vestingWallet.setVariable('totalAmountPerToken', {
        [DAI_ADDRESS]: VEST_AMOUNT.mul(2), // one by each beneficiary
      });
      await vestingWallet.addBeneficiaryForTest(beneficiary);
      await vestingWallet.addBeneficiaryForTest(anotherBeneficiary);

      await vestingWallet.addTokenForTest(DAI_ADDRESS);
      await vestingWallet.addTokenToBeneficiaryForTest(DAI_ADDRESS, beneficiary);
      await vestingWallet.addTokenToBeneficiaryForTest(DAI_ADDRESS, anotherBeneficiary);
    });

    it('should revert if transfer fails', async () => {
      dai.transfer.reverts();
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(owner)['release(address,address)'](DAI_ADDRESS, beneficiary)).to.be.revertedWith(
        'SafeERC20: low-level call failed'
      );
    });

    it('should revert if transfer does not succeed', async () => {
      dai.transfer.returns(false);
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(owner)['release(address,address)'](DAI_ADDRESS, beneficiary)).to.be.revertedWith(
        'SafeERC20: ERC20 operation did not succeed'
      );
    });

    context('when vesting period has not yet started', () => {
      beforeEach(async () => {
        await evm.advanceToTime(START_DATE - 1);
      });

      it('should not do any transfer', async () => {
        await vestingWallet.connect(owner)['release(address,address)'](DAI_ADDRESS, beneficiary);
        expect(dai.transfer).to.not.have.been.called;
      });

      it('should not emit events', async () => {
        await expect(vestingWallet.connect(owner)['release(address,address)'](DAI_ADDRESS, beneficiary)).to.not.emit(
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
        tx = await vestingWallet.connect(owner)['release(address,address)'](DAI_ADDRESS, beneficiary);

        // query latest block timestamp for precise calculation
        timestamp = (await ethers.provider.getBlock('latest')).timestamp;
        partialDuration = timestamp - START_DATE;

        releaseableAmount = VEST_AMOUNT.mul(partialDuration).div(DURATION);
      });

      it('should transfer releaseable ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, releaseableAmount);
      });

      it('should emit event', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, releaseableAmount);
      });
    });

    context('when vesting period has ended', () => {
      beforeEach(async () => {
        dai.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION);
        tx = await vestingWallet.connect(owner)['release(address,address)'](DAI_ADDRESS, beneficiary);
      });

      it('should transfer total ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
      });

      it('should delete the benefit', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary)).startDate).to.be.equal(0);
      });

      it('should remove the beneficiary from the list', async () => {
        expect(await vestingWallet.callStatic.getBeneficiaries()).to.not.include(beneficiary);
      });

      it("should remove the token from beneficiary-token's list", async () => {
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary)).to.not.include(DAI_ADDRESS);
      });

      it('should keep the token in others beneficiary-token lists', async () => {
        expect(await vestingWallet.callStatic.getTokensOf(anotherBeneficiary)).to.include(DAI_ADDRESS);
      });

      it('should not remove the token if there is another beneficiary using it', async () => {
        expect(await vestingWallet.callStatic.getTokens()).to.include(DAI_ADDRESS);
      });

      it('should remove the token if it has not more beneficiaries', async () => {
        await vestingWallet.connect(owner)['release(address,address)'](DAI_ADDRESS, anotherBeneficiary);
        expect(await vestingWallet.callStatic.getTokens()).not.to.include(DAI_ADDRESS);
      });
    });
  });

  describe('release(address)', () => {
    let beneficiarySigner: JsonRpcSigner;
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
          [anotherBeneficiary]: {
            ['amount']: VEST_AMOUNT,
            ['startDate']: START_DATE,
            ['duration']: DURATION,
          },
        },
      });

      await vestingWallet.setVariable('totalAmountPerToken', {
        [DAI_ADDRESS]: VEST_AMOUNT.mul(2), // one by each beneficiary
      });

      await vestingWallet.addBeneficiaryForTest(beneficiary);
      await vestingWallet.addBeneficiaryForTest(anotherBeneficiary);

      await vestingWallet.addTokenForTest(DAI_ADDRESS);

      await vestingWallet.addTokenToBeneficiaryForTest(DAI_ADDRESS, beneficiary);
      await vestingWallet.addTokenToBeneficiaryForTest(DAI_ADDRESS, anotherBeneficiary);
    });

    beforeEach(async () => {
      beneficiarySigner = await wallet.impersonate(beneficiary);
      await owner.sendTransaction({ to: beneficiary, value: toUnit(1) });
    });

    it('should revert if transfer fails', async () => {
      dai.transfer.reverts();
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(beneficiarySigner)['release(address)'](DAI_ADDRESS)).to.be.revertedWith(
        'SafeERC20: low-level call failed'
      );
    });

    it('should revert if transfer does not succeed', async () => {
      dai.transfer.returns(false);
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(beneficiarySigner)['release(address)'](DAI_ADDRESS)).to.be.revertedWith(
        'SafeERC20: ERC20 operation did not succeed'
      );
    });

    context('when vesting period has not yet started', () => {
      beforeEach(async () => {
        await evm.advanceToTimeAndBlock(START_DATE - 1);
      });

      it('should not do any transfer', async () => {
        await vestingWallet.connect(beneficiarySigner)['release(address)'](DAI_ADDRESS);
        expect(dai.transfer).to.not.have.been.called;
      });

      it('should not emit events', async () => {
        await expect(vestingWallet.connect(beneficiarySigner)['release(address)'](DAI_ADDRESS)).to.not.emit(vestingWallet, 'BenefitReleased');
      });
    });

    context('when vesting period is ongoing', () => {
      let timestamp: number;
      let partialDuration: number;
      let releaseableAmount: BigNumber;

      beforeEach(async () => {
        dai.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);
        tx = await vestingWallet.connect(beneficiarySigner)['release(address)'](DAI_ADDRESS);

        // query latest block timestamp for precise calculation
        timestamp = (await ethers.provider.getBlock('latest')).timestamp;
        partialDuration = timestamp - START_DATE;

        releaseableAmount = VEST_AMOUNT.mul(partialDuration).div(DURATION);
      });

      it('should transfer releaseable ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, releaseableAmount);
      });

      it('should emit event', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, releaseableAmount);
      });
    });

    context('when vesting period has ended', () => {
      beforeEach(async () => {
        dai.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION);
        tx = await vestingWallet.connect(beneficiarySigner)['release(address)'](DAI_ADDRESS);
      });

      it('should transfer total ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
      });

      it('should emit event', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
      });

      it('should delete the benefit', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary)).startDate).to.be.equal(0);
      });

      it('should remove the beneficiary from the list', async () => {
        expect(await vestingWallet.callStatic.getBeneficiaries()).to.not.include(beneficiary);
      });

      it("should remove the token from beneficiary-token's list", async () => {
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary)).to.not.include(DAI_ADDRESS);
      });

      it('should keep the token in others beneficiary-token lists', async () => {
        expect(await vestingWallet.callStatic.getTokensOf(anotherBeneficiary)).to.include(DAI_ADDRESS);
      });

      it('should emit event', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
      });
    });
  });

  describe('release(address[],address)', () => {
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

      await vestingWallet.addBeneficiaryForTest(beneficiary);

      await vestingWallet.addTokenForTest(DAI_ADDRESS);
      await vestingWallet.addTokenForTest(USDC_ADDRESS);

      await vestingWallet.addTokenToBeneficiaryForTest(DAI_ADDRESS, beneficiary);
      await vestingWallet.addTokenToBeneficiaryForTest(USDC_ADDRESS, beneficiary);

      dai.transfer.reset();
      usdc.transfer.reset();
    });

    it('should revert if one transfer fails', async () => {
      dai.transfer.reverts();
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(owner)['release(address[],address)']([DAI_ADDRESS, USDC_ADDRESS], beneficiary)).to.be.revertedWith(
        'SafeERC20: low-level call failed'
      );
    });

    it('should revert if one transfer does not succeed', async () => {
      dai.transfer.returns(false);
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(owner)['release(address[],address)']([DAI_ADDRESS, USDC_ADDRESS], beneficiary)).to.be.revertedWith(
        'SafeERC20: ERC20 operation did not succeed'
      );
    });

    context('when none of the vesting periods has yet started', () => {
      beforeEach(async () => {
        await evm.advanceToTimeAndBlock(START_DATE_USDC - DURATION_USDC - 1);
      });

      it('should not do any transfer', async () => {
        await vestingWallet.connect(owner)['release(address[],address)']([DAI_ADDRESS, USDC_ADDRESS], beneficiary);
        expect(dai.transfer).to.not.have.been.called;
        expect(usdc.transfer).to.not.have.been.called;
      });

      it('should not emit events', async () => {
        await expect(vestingWallet.connect(owner)['release(address[],address)']([DAI_ADDRESS, USDC_ADDRESS], beneficiary)).to.not.emit(
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
        tx = await vestingWallet.connect(owner)['release(address[],address)']([DAI_ADDRESS, USDC_ADDRESS], beneficiary);

        // query latest block timestamp for precise calculation
        timestamp = (await ethers.provider.getBlock('latest')).timestamp;
        partialDurationUsdc = timestamp - START_DATE_USDC;

        partialReleasedUsdc = VEST_AMOUNT.mul(partialDurationUsdc).div(DURATION_USDC);
      });

      it('should transfer releaseable ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).not.to.have.been.called;
        expect(usdc.transfer).to.have.been.calledWith(beneficiary, partialReleasedUsdc);
      });

      it('should emit event', async () => {
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
        tx = await vestingWallet.connect(owner)['release(address[],address)']([DAI_ADDRESS, USDC_ADDRESS], beneficiary);

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

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, partialReleasedDai);
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, partialReleasedUsdc);
      });
    });

    context('when vesting periods have ended', () => {
      beforeEach(async () => {
        dai.transfer.returns(true);
        usdc.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION);
        tx = await vestingWallet.connect(owner)['release(address[],address)']([DAI_ADDRESS, USDC_ADDRESS], beneficiary);
      });

      it('should transfer both total ERC20 amounts to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
        expect(usdc.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
      });

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, VEST_AMOUNT);
      });

      it('should delete the benefit', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary)).startDate).to.be.equal(0);
      });

      it('should remove the beneficiary from the beneficiaries list', async () => {
        expect(await vestingWallet.callStatic.getBeneficiaries()).to.not.include(beneficiary);
      });

      it('should remove the token from beneficiary-token list', async () => {
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary)).to.not.include(DAI_ADDRESS);
      });

      it('should remove the token if it has not more beneficiaries', async () => {
        expect(await vestingWallet.callStatic.getTokens()).to.not.include(DAI_ADDRESS);
      });
    });
  });

  describe('release(address[])', () => {
    let beneficiarySigner: JsonRpcSigner;
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

      await vestingWallet.addBeneficiaryForTest(beneficiary);

      await vestingWallet.addTokenForTest(DAI_ADDRESS);
      await vestingWallet.addTokenForTest(USDC_ADDRESS);

      await vestingWallet.addTokenToBeneficiaryForTest(DAI_ADDRESS, beneficiary);
      await vestingWallet.addTokenToBeneficiaryForTest(USDC_ADDRESS, beneficiary);

      beneficiarySigner = await wallet.impersonate(beneficiary);
      owner.sendTransaction({ to: beneficiary, value: toUnit(1) });
      dai.transfer.reset();
      usdc.transfer.reset();
    });

    it('should revert if one transfer fails', async () => {
      dai.transfer.reverts();
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(beneficiarySigner)['release(address[])']([DAI_ADDRESS, USDC_ADDRESS])).to.be.revertedWith(
        'SafeERC20: low-level call failed'
      );
    });

    it('should revert if one transfer does not succeed', async () => {
      dai.transfer.returns(false);
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(beneficiarySigner)['release(address[])']([DAI_ADDRESS, USDC_ADDRESS])).to.be.revertedWith(
        'SafeERC20: ERC20 operation did not succeed'
      );
    });

    context('when none of the vesting periods has yet started', () => {
      beforeEach(async () => {
        await evm.advanceToTimeAndBlock(START_DATE_USDC - DURATION_USDC - 10);
      });

      it('should not do any transfer', async () => {
        await vestingWallet.connect(beneficiarySigner)['release(address[])']([DAI_ADDRESS, USDC_ADDRESS]);
        expect(dai.transfer).to.not.have.been.called;
        expect(usdc.transfer).to.not.have.been.called;
      });

      it('should not emit events', async () => {
        await expect(vestingWallet.connect(beneficiarySigner)['release(address[])']([DAI_ADDRESS, USDC_ADDRESS])).to.not.emit(
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

        await evm.advanceToTimeAndBlock(START_DATE - 2);
        tx = await vestingWallet.connect(beneficiarySigner)['release(address[])']([DAI_ADDRESS, USDC_ADDRESS]);

        // query latest block timestamp for precise calculation
        timestamp = (await ethers.provider.getBlock('latest')).timestamp;
        partialDurationUsdc = timestamp - START_DATE_USDC;

        partialReleasedUsdc = VEST_AMOUNT.mul(partialDurationUsdc).div(DURATION_USDC);
      });

      it('should transfer releaseable ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).not.to.have.been.called;
        expect(usdc.transfer).to.have.been.calledWith(beneficiary, partialReleasedUsdc);
      });

      it('should emit event', async () => {
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
        tx = await vestingWallet.connect(beneficiarySigner)['release(address[])']([DAI_ADDRESS, USDC_ADDRESS]);

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

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, partialReleasedDai);
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, partialReleasedUsdc);
      });
    });

    context('when vesting periods have ended', () => {
      beforeEach(async () => {
        dai.transfer.returns(true);
        usdc.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION);
        tx = await vestingWallet.connect(beneficiarySigner)['release(address[])']([DAI_ADDRESS, USDC_ADDRESS]);
      });

      it('should transfer both total ERC20 amounts to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
        expect(usdc.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
      });

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, VEST_AMOUNT);
      });

      it('should delete the benefit', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary)).startDate).to.be.equal(0);
      });

      it('should remove the beneficiary from the beneficiaries list', async () => {
        expect(await vestingWallet.callStatic.getBeneficiaries()).to.not.include(beneficiary);
      });

      it('should remove the token from beneficiary-token list', async () => {
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary)).to.not.include(DAI_ADDRESS);
      });

      it('should remove the token if it has not more beneficiaries', async () => {
        expect(await vestingWallet.callStatic.getTokens()).to.not.include(DAI_ADDRESS);
      });

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, VEST_AMOUNT);
      });
    });
  });

  describe('releaseAll()', () => {
    let beneficiarySigner: JsonRpcSigner;
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

      await vestingWallet.addBeneficiaryForTest(beneficiary);

      await vestingWallet.addTokenForTest(DAI_ADDRESS);
      await vestingWallet.addTokenForTest(USDC_ADDRESS);

      await vestingWallet.addTokenToBeneficiaryForTest(DAI_ADDRESS, beneficiary);
      await vestingWallet.addTokenToBeneficiaryForTest(USDC_ADDRESS, beneficiary);

      beneficiarySigner = await wallet.impersonate(beneficiary);
      owner.sendTransaction({ to: beneficiary, value: toUnit(1) });
      dai.transfer.reset();
      usdc.transfer.reset();
    });

    it('should revert if one transfer fails', async () => {
      dai.transfer.reverts();
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(beneficiarySigner)['releaseAll()']()).to.be.revertedWith('SafeERC20: low-level call failed');
    });

    it('should revert if one transfer does not succeed', async () => {
      dai.transfer.returns(false);
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(beneficiarySigner)['releaseAll()']()).to.be.revertedWith('SafeERC20: ERC20 operation did not succeed');
    });

    context('when none of the vesting periods has yet started', () => {
      beforeEach(async () => {
        await evm.advanceToTimeAndBlock(START_DATE_USDC - DURATION_USDC - 10);
      });

      it('should not do any transfer', async () => {
        await vestingWallet.connect(beneficiarySigner)['releaseAll()']();
        expect(dai.transfer).to.not.have.been.called;
        expect(usdc.transfer).to.not.have.been.called;
      });

      it('should not emit events', async () => {
        await expect(vestingWallet.connect(beneficiarySigner)['releaseAll()']()).to.not.emit(vestingWallet, 'BenefitReleased');
      });
    });

    context('when one of vesting period is ongoing', () => {
      let timestamp: number;
      let partialDurationUsdc: number;
      let partialReleasedUsdc: BigNumber;

      beforeEach(async () => {
        usdc.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE - 2);
        tx = await vestingWallet.connect(beneficiarySigner)['releaseAll()']();

        // query latest block timestamp for precise calculation
        timestamp = (await ethers.provider.getBlock('latest')).timestamp;
        partialDurationUsdc = timestamp - START_DATE_USDC;

        partialReleasedUsdc = VEST_AMOUNT.mul(partialDurationUsdc).div(DURATION_USDC);
      });

      it('should transfer releaseable ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).not.to.have.been.called;
        expect(usdc.transfer).to.have.been.calledWith(beneficiary, partialReleasedUsdc);
      });

      it('should emit event', async () => {
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
        tx = await vestingWallet.connect(beneficiarySigner)['releaseAll()']();

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

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, partialReleasedDai);
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, partialReleasedUsdc);
      });
    });

    context('when vesting periods have ended', () => {
      beforeEach(async () => {
        dai.transfer.returns(true);
        usdc.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION);
        tx = await vestingWallet.connect(beneficiarySigner)['releaseAll()']();
      });

      it('should transfer both total ERC20 amounts to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
        expect(usdc.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
      });

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, VEST_AMOUNT);
      });

      it('should delete the benefit', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary)).startDate).to.be.equal(0);
      });

      it('should remove the beneficiary from the beneficiaries list', async () => {
        expect(await vestingWallet.callStatic.getBeneficiaries()).to.not.include(beneficiary);
      });

      it('should remove the token from beneficiary-token list', async () => {
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary)).to.not.include(DAI_ADDRESS);
      });

      it('should remove the token if it has not more beneficiaries', async () => {
        expect(await vestingWallet.callStatic.getTokens()).to.not.include(DAI_ADDRESS);
      });

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, VEST_AMOUNT);
      });
    });
  });

  describe('releaseAll(address)', () => {
    let beneficiarySigner: JsonRpcSigner;
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

      await vestingWallet.addBeneficiaryForTest(beneficiary);

      await vestingWallet.addTokenForTest(DAI_ADDRESS);
      await vestingWallet.addTokenForTest(USDC_ADDRESS);

      await vestingWallet.addTokenToBeneficiaryForTest(DAI_ADDRESS, beneficiary);
      await vestingWallet.addTokenToBeneficiaryForTest(USDC_ADDRESS, beneficiary);

      beneficiarySigner = await wallet.impersonate(beneficiary);
      owner.sendTransaction({ to: beneficiary, value: toUnit(1) });
      dai.transfer.reset();
      usdc.transfer.reset();
    });

    it('should revert if one transfer fails', async () => {
      dai.transfer.reverts();
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(beneficiarySigner)['releaseAll(address)'](beneficiary)).to.be.revertedWith(
        'SafeERC20: low-level call failed'
      );
    });

    it('should revert if one transfer does not succeed', async () => {
      dai.transfer.returns(false);
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(beneficiarySigner)['releaseAll(address)'](beneficiary)).to.be.revertedWith(
        'SafeERC20: ERC20 operation did not succeed'
      );
    });

    context('when none of the vesting periods has yet started', () => {
      beforeEach(async () => {
        await evm.advanceToTimeAndBlock(START_DATE_USDC - DURATION_USDC - 10);
      });

      it('should not do any transfer', async () => {
        await vestingWallet.connect(beneficiarySigner)['releaseAll(address)'](beneficiary);
        expect(dai.transfer).to.not.have.been.called;
        expect(usdc.transfer).to.not.have.been.called;
      });

      it('should not emit events', async () => {
        await expect(vestingWallet.connect(beneficiarySigner)['releaseAll(address)'](beneficiary)).to.not.emit(vestingWallet, 'BenefitReleased');
      });
    });

    context('when one of vesting period is ongoing', () => {
      let timestamp: number;
      let partialDurationUsdc: number;
      let partialReleasedUsdc: BigNumber;

      beforeEach(async () => {
        usdc.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE - 2);
        tx = await vestingWallet.connect(beneficiarySigner)['releaseAll(address)'](beneficiary);

        // query latest block timestamp for precise calculation
        timestamp = (await ethers.provider.getBlock('latest')).timestamp;
        partialDurationUsdc = timestamp - START_DATE_USDC;

        partialReleasedUsdc = VEST_AMOUNT.mul(partialDurationUsdc).div(DURATION_USDC);
      });

      it('should transfer releaseable ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).not.to.have.been.called;
        expect(usdc.transfer).to.have.been.calledWith(beneficiary, partialReleasedUsdc);
      });

      it('should emit event', async () => {
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
        tx = await vestingWallet.connect(beneficiarySigner)['releaseAll(address)'](beneficiary);

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

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, partialReleasedDai);
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, partialReleasedUsdc);
      });
    });

    context('when vesting periods have ended', () => {
      beforeEach(async () => {
        dai.transfer.returns(true);
        usdc.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION);
        tx = await vestingWallet.connect(beneficiarySigner)['releaseAll(address)'](beneficiary);
      });

      it('should transfer both total ERC20 amounts to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
        expect(usdc.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
      });

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, VEST_AMOUNT);
      });

      it('should delete the benefit', async () => {
        expect((await vestingWallet.callStatic.benefits(DAI_ADDRESS, beneficiary)).startDate).to.be.equal(0);
      });

      it('should remove the beneficiary from the beneficiaries list', async () => {
        expect(await vestingWallet.callStatic.getBeneficiaries()).to.not.include(beneficiary);
      });

      it('should remove the token from beneficiary-token list', async () => {
        expect(await vestingWallet.callStatic.getTokensOf(beneficiary)).to.not.include(DAI_ADDRESS);
      });

      it('should remove the token if it has not more beneficiaries', async () => {
        expect(await vestingWallet.callStatic.getTokens()).to.not.include(DAI_ADDRESS);
      });

      it('should emit events', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(DAI_ADDRESS, beneficiary, VEST_AMOUNT);
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased').withArgs(USDC_ADDRESS, beneficiary, VEST_AMOUNT);
      });
    });
  });
});

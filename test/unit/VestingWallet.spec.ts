import { IERC20 } from '@typechained';
import { toUnit } from '@utils/bn';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { ethers } from 'hardhat';
import { BigNumber, Transaction } from 'ethers';
import { VestingWallet, VestingWallet__factory } from '@typechained';
import { evm, wallet, behaviours } from '@utils';
import { DAI_ADDRESS, DURATION, PARTIAL_DURATION, START_DATE, VEST_AMOUNT } from '@utils/constants';
import { FakeContract, MockContract, MockContractFactory, smock } from '@defi-wonderland/smock';
import chai, { expect } from 'chai';

chai.use(smock.matchers);

describe('VestingWallet', () => {
  let vestingWallet: MockContract<VestingWallet>;
  let vestingWalletFactory: MockContractFactory<VestingWallet__factory>;
  let snapshotId: string;
  let owner: SignerWithAddress;
  let dai: FakeContract<IERC20>;

  const beneficiary = wallet.generateRandomAddress();

  before(async () => {
    [, owner] = await ethers.getSigners();
    vestingWalletFactory = await smock.mock<VestingWallet__factory>('VestingWallet');
    vestingWallet = await vestingWalletFactory.connect(owner).deploy(owner.address);
    dai = await smock.fake('ERC20', { address: DAI_ADDRESS });

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
      await vestingWallet.setVariable('startDate', {
        [beneficiary]: {
          [DAI_ADDRESS]: START_DATE,
        },
      });
      await vestingWallet.setVariable('_duration', {
        [beneficiary]: {
          [DAI_ADDRESS]: DURATION,
        },
      });
      await vestingWallet.setVariable('amount', {
        [beneficiary]: {
          [DAI_ADDRESS]: VEST_AMOUNT,
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
      await vestingWallet.release(beneficiary, DAI_ADDRESS);
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
      beforeEach(async () => {
        dai.transferFrom.returns(true);

        await vestingWallet.connect(owner).addBenefit(beneficiary, START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);
      });

      it('should transfer the token to the contract', async () => {
        expect(dai.transferFrom).to.be.calledOnce;
      });

      it('should update amount', async () => {
        expect(await vestingWallet.callStatic.amount(beneficiary, DAI_ADDRESS)).to.equal(VEST_AMOUNT);
      });

      it('should update releaseDate', async () => {
        expect(await vestingWallet.callStatic.releaseDate(beneficiary, DAI_ADDRESS)).to.equal(RELEASE_DATE);
      });

      it('should update startDate', async () => {
        expect(await vestingWallet.callStatic.startDate(beneficiary, DAI_ADDRESS)).to.equal(START_DATE);
      });
    });

    context('when there was a previous benefit', () => {
      const NEW_START_DATE = START_DATE * 10;

      beforeEach(async () => {
        dai.transfer.returns(true);
        dai.transferFrom.returns(true);

        await vestingWallet.setVariable('startDate', {
          [beneficiary]: {
            [DAI_ADDRESS]: START_DATE,
          },
        });
        await vestingWallet.setVariable('_duration', {
          [beneficiary]: {
            [DAI_ADDRESS]: DURATION,
          },
        });
        await vestingWallet.setVariable('amount', {
          [beneficiary]: {
            [DAI_ADDRESS]: VEST_AMOUNT,
          },
        });
        await vestingWallet.setVariable('totalAmountPerToken', {
          [DAI_ADDRESS]: VEST_AMOUNT,
        });
      });

      it('should overwrite start date', async () => {
        await vestingWallet.connect(owner).addBenefit(beneficiary, NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);

        expect(await vestingWallet.startDate(beneficiary, DAI_ADDRESS)).to.eq(NEW_START_DATE);
      });

      it('should overwrite release date', async () => {
        await vestingWallet.connect(owner).addBenefit(beneficiary, NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);

        expect(await vestingWallet.releaseDate(beneficiary, DAI_ADDRESS)).to.eq(NEW_START_DATE + DURATION);
      });

      context('when previous benefit has not yet started', () => {
        it('should add previous amount to new benefit', async () => {
          await vestingWallet.connect(owner).addBenefit(beneficiary, NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);

          expect(await vestingWallet.amount(beneficiary, DAI_ADDRESS)).to.eq(VEST_AMOUNT.mul(2));
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
          expect(await vestingWallet.amount(beneficiary, DAI_ADDRESS)).to.eq(VEST_AMOUNT.add(VEST_AMOUNT.sub(partialBenefit)));
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
          expect(await vestingWallet.amount(beneficiary, DAI_ADDRESS)).to.eq(VEST_AMOUNT);
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
      await vestingWallet.setVariable('startDate', {
        [beneficiary]: {
          [DAI_ADDRESS]: START_DATE,
        },
      });
      await vestingWallet.setVariable('_duration', {
        [beneficiary]: {
          [DAI_ADDRESS]: DURATION,
        },
      });
      await vestingWallet.setVariable('amount', {
        [beneficiary]: {
          [DAI_ADDRESS]: VEST_AMOUNT,
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

  describe('release', () => {
    const DENOMINATOR = 3;
    let tx: Transaction;

    beforeEach(async () => {
      await vestingWallet.setVariable('startDate', {
        [beneficiary]: {
          [DAI_ADDRESS]: START_DATE,
        },
      });
      await vestingWallet.setVariable('_duration', {
        [beneficiary]: {
          [DAI_ADDRESS]: DURATION,
        },
      });
      await vestingWallet.setVariable('amount', {
        [beneficiary]: {
          [DAI_ADDRESS]: VEST_AMOUNT,
        },
      });
      await vestingWallet.setVariable('totalAmountPerToken', {
        [DAI_ADDRESS]: VEST_AMOUNT,
      });
    });

    it('should revert if transfer fails', async () => {
      dai.transfer.reverts();
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(owner).release(beneficiary, DAI_ADDRESS)).to.be.revertedWith('SafeERC20: low-level call failed');
    });

    it('should revert if transfer does not succeed', async () => {
      dai.transfer.returns(false);
      await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);

      await expect(vestingWallet.connect(owner).release(beneficiary, DAI_ADDRESS)).to.be.revertedWith(
        'SafeERC20: ERC20 operation did not succeed'
      );
    });

    context('when vesting period has not yet started', () => {
      beforeEach(async () => {
        await evm.advanceToTime(START_DATE - 1);
      });

      it('should not do any transfer', async () => {
        await vestingWallet.connect(owner).release(beneficiary, DAI_ADDRESS);
        expect(dai.transfer).to.not.have.been.called;
      });

      it('should not emit the BenefitReleased event', async () => {
        await expect(vestingWallet.connect(owner).release(beneficiary, DAI_ADDRESS)).to.not.emit(vestingWallet, 'BenefitReleased');
      });
    });

    context('when vesting period is ongoing', () => {
      let timestamp: number;
      let partialDuration: number;

      beforeEach(async () => {
        dai.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION / DENOMINATOR);
        tx = await vestingWallet.connect(owner).release(beneficiary, DAI_ADDRESS);

        // query latest block timestamp for precise calculation
        timestamp = (await ethers.provider.getBlock('latest')).timestamp;
        partialDuration = timestamp - START_DATE;
      });

      it('should transfer releaseable ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT.mul(partialDuration).div(DURATION));
      });

      it('should emit the BenefitReleased event', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased');
      });
    });

    context('when vesting period has ended', () => {
      beforeEach(async () => {
        dai.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION);
        tx = await vestingWallet.connect(owner).release(beneficiary, DAI_ADDRESS);
      });

      it('should transfer total ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
      });

      it('should emit the BenefitReleased event', async () => {
        await expect(tx).to.emit(vestingWallet, 'BenefitReleased');
      });
    });
  });
});

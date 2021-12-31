import { IERC20 } from '@typechained';
import { toUnit } from '@utils/bn';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { VestingWallet, VestingWallet__factory } from '@typechained';
import { evm, contracts, wallet, behaviours } from '@utils';
import { DAI_ADDRESS, DURATION, ETH_ADDRESS, PARTIAL_DURATION, START_DATE, VEST_AMOUNT } from '@utils/constants';
import { FakeContract, MockContract, MockContractFactory, smock } from '@defi-wonderland/smock';
import chai, { expect } from 'chai';
import { setBalance } from '@utils/contracts';

chai.use(smock.matchers);

describe('VestingWallet', () => {
  let vestingWallet: MockContract<VestingWallet>;
  let vestingWalletFactory: MockContractFactory<VestingWallet__factory>;
  let snapshotId: string;
  let ethProvider: SignerWithAddress;
  let owner: SignerWithAddress;
  let beneficiary: string;
  let dai: FakeContract<IERC20>;

  before(async () => {
    [ethProvider, owner] = await ethers.getSigners();
    beneficiary = wallet.generateRandomAddress();
    vestingWalletFactory = await smock.mock<VestingWallet__factory>('VestingWallet');
    vestingWallet = await vestingWalletFactory.connect(owner).deploy(beneficiary);
    dai = await smock.fake('ERC20', { address: DAI_ADDRESS });

    snapshotId = await evm.snapshot.take();
  });

  beforeEach(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  after(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  describe('constructor', () => {
    it('should set the beneficiary address', async () => {
      expect(await vestingWallet.beneficiary()).to.equal(beneficiary);
    });
  });

  describe('releasableAmount(address)', () => {
    beforeEach(async () => {
      vestingWallet.setVariable('startDatePerToken', { [DAI_ADDRESS]: START_DATE });
      vestingWallet.setVariable('releaseDatePerToken', { [DAI_ADDRESS]: START_DATE + DURATION });
      vestingWallet.setVariable('amountPerToken', { [DAI_ADDRESS]: VEST_AMOUNT });
    });

    it('should return 0 if vest has not yet started', async () => {
      await evm.advanceToTimeAndBlock(START_DATE - 1);
      expect(await vestingWallet['releasableAmount(address)'](DAI_ADDRESS)).to.be.eq(0);
    });

    it('should return total bonds if vest has finalized', async () => {
      await evm.advanceToTimeAndBlock(START_DATE + DURATION + 1);
      expect(await vestingWallet['releasableAmount(address)'](DAI_ADDRESS)).to.be.eq(VEST_AMOUNT);
    });

    it('should return a partial amount if vest is ongoing', async () => {
      await evm.advanceToTimeAndBlock(START_DATE + PARTIAL_DURATION);
      expect(await vestingWallet['releasableAmount(address)'](DAI_ADDRESS)).to.be.eq(VEST_AMOUNT.mul(PARTIAL_DURATION).div(DURATION));
    });

    it('should return 0 if claimable bonds has been released', async () => {
      dai.transfer.reset();
      dai.transfer.returns(true);

      await evm.advanceToTimeAndBlock(START_DATE + PARTIAL_DURATION);
      await vestingWallet['release(address)'](DAI_ADDRESS);
      expect(await vestingWallet['releasableAmount(address)'](DAI_ADDRESS)).to.be.eq(0);
    });
  });

  describe('releasableAmount()', () => {
    beforeEach(async () => {
      vestingWallet.setVariable('startDatePerToken', { [ETH_ADDRESS]: START_DATE });
      vestingWallet.setVariable('releaseDatePerToken', { [ETH_ADDRESS]: START_DATE + DURATION });
      vestingWallet.setVariable('amountPerToken', { [ETH_ADDRESS]: VEST_AMOUNT });

      await setBalance(vestingWallet.address, VEST_AMOUNT);
    });

    it('should return 0 if vest has not yet started', async () => {
      await evm.advanceToTimeAndBlock(START_DATE - 1);
      expect(await vestingWallet['releasableAmount()']()).to.be.eq(0);
    });

    it('should return total bonds if vest has finalized', async () => {
      await evm.advanceToTimeAndBlock(START_DATE + DURATION + 1);
      expect(await vestingWallet['releasableAmount()']()).to.be.eq(VEST_AMOUNT);
    });

    it('should return a partial amount if vest is ongoing', async () => {
      await evm.advanceToTimeAndBlock(START_DATE + PARTIAL_DURATION);
      expect(await vestingWallet['releasableAmount()']()).to.be.eq(VEST_AMOUNT.mul(PARTIAL_DURATION).div(DURATION));
    });

    it('should be equivalent to use releasableAmount(address) with ETH address', async () => {
      await evm.advanceToTimeAndBlock(START_DATE + DURATION);
      const releasableAmount = await vestingWallet['releasableAmount()']();
      const releasableAmountWithAddress = await vestingWallet['releasableAmount(address)'](ETH_ADDRESS);
      expect(releasableAmount).to.be.eq(releasableAmountWithAddress);
    });

    it('should return 0 if claimable bonds has been released', async () => {
      await evm.advanceToTimeAndBlock(START_DATE + PARTIAL_DURATION);
      await vestingWallet['release()']();
      expect(await vestingWallet['releasableAmount()']()).to.be.eq(0);
    });
  });

  describe('addBenefit(address)', () => {
    const RELEASE_DATE = START_DATE + DURATION;

    behaviours.onlyOwner(() => vestingWallet, 'addBenefit(uint64,uint64,address,uint256)', owner, [
      START_DATE,
      DURATION,
      DAI_ADDRESS,
      VEST_AMOUNT,
    ]);

    context('when there was no previous benefit', () => {
      beforeEach(async () => {
        dai.transferFrom.reset();
        dai.transferFrom.returns(true);

        await vestingWallet.connect(owner)['addBenefit(uint64,uint64,address,uint256)'](START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);
      });

      it('should transfer the token to the contract', async () => {
        expect(dai.transferFrom).to.be.calledOnce;
      });

      it('should update amountPerToken', async () => {
        expect(await vestingWallet.callStatic.amountPerToken(DAI_ADDRESS)).to.equal(VEST_AMOUNT);
      });

      it('should update releaseDatePerToken', async () => {
        expect(await vestingWallet.callStatic.releaseDatePerToken(DAI_ADDRESS)).to.equal(RELEASE_DATE);
      });

      it('should update startDatePerToken', async () => {
        expect(await vestingWallet.callStatic.startDatePerToken(DAI_ADDRESS)).to.equal(START_DATE);
      });
    });

    context('when there was a previous benefit', () => {
      const NEW_START_DATE = START_DATE * 10;

      beforeEach(async () => {
        dai.transfer.reset();
        dai.transfer.returns(true);
        dai.transferFrom.reset();
        dai.transferFrom.returns(true);
        vestingWallet.setVariable('startDatePerToken', { [DAI_ADDRESS]: START_DATE });
        vestingWallet.setVariable('releaseDatePerToken', { [DAI_ADDRESS]: START_DATE + DURATION });
        vestingWallet.setVariable('amountPerToken', { [DAI_ADDRESS]: VEST_AMOUNT });
      });

      it('should overwrite start date', async () => {
        await vestingWallet.connect(owner)['addBenefit(uint64,uint64,address,uint256)'](NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);

        expect(await vestingWallet.startDatePerToken(DAI_ADDRESS)).to.eq(NEW_START_DATE);
      });

      it('should overwrite release date', async () => {
        await vestingWallet.connect(owner)['addBenefit(uint64,uint64,address,uint256)'](NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);

        expect(await vestingWallet.releaseDatePerToken(DAI_ADDRESS)).to.eq(NEW_START_DATE + DURATION);
      });

      context('when previous benefit has not yet started', () => {
        it('should add previous amount to new benefit', async () => {
          await vestingWallet.connect(owner)['addBenefit(uint64,uint64,address,uint256)'](NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);

          expect(await vestingWallet.amountPerToken(DAI_ADDRESS)).to.eq(VEST_AMOUNT.mul(2));
        });
      });

      context('when previous benefit is ongoing', () => {
        const PARTIAL_PROPORTION = 3;
        let timestamp: number;
        let partialDuration: number;
        let partialBenefit: BigNumber;

        beforeEach(async () => {
          await evm.advanceToTimeAndBlock(START_DATE + DURATION / PARTIAL_PROPORTION);
          await vestingWallet.connect(owner)['addBenefit(uint64,uint64,address,uint256)'](NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);
          // query latest block timestamp for precise calculation
          timestamp = (await ethers.provider.getBlock('latest')).timestamp;
          partialDuration = timestamp - START_DATE;
          partialBenefit = VEST_AMOUNT.mul(partialDuration).div(DURATION);
        });

        it('should release ongoing benefit', async () => {
          expect(dai.transfer).to.have.been.calledWith(beneficiary, partialBenefit);
        });

        it('should add remaining amount to new benefit', async () => {
          expect(await vestingWallet.amountPerToken(DAI_ADDRESS)).to.eq(VEST_AMOUNT.add(VEST_AMOUNT.sub(partialBenefit)));
        });
      });

      context('when previous benefit has ended', () => {
        beforeEach(async () => {
          await evm.advanceToTimeAndBlock(START_DATE + DURATION);
          await vestingWallet.connect(owner)['addBenefit(uint64,uint64,address,uint256)'](NEW_START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);
        });

        it('should release all previous benefit', async () => {
          expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
        });

        it('should not add any amount to new benefit', async () => {
          expect(await vestingWallet.amountPerToken(DAI_ADDRESS)).to.eq(VEST_AMOUNT);
        });
      });
    });
  });

  describe('addBenefit()', () => {
    const RELEASE_DATE = START_DATE + DURATION;

    behaviours.onlyOwner(() => vestingWallet, 'addBenefit(uint64,uint64)', owner, [START_DATE, DURATION]);

    context('when there was no previous benefit', () => {
      beforeEach(async () => {
        await vestingWallet.connect(owner)['addBenefit(uint64,uint64)'](START_DATE, DURATION, {
          value: VEST_AMOUNT,
        });
      });

      it('should transfer the token to the contract', async () => {
        expect(await ethers.provider.getBalance(vestingWallet.address)).to.equal(VEST_AMOUNT);
      });

      it('should update amountPerToken', async () => {
        expect(await vestingWallet.callStatic.amountPerToken(ETH_ADDRESS)).to.equal(VEST_AMOUNT);
      });

      it('should update releaseDatePerToken', async () => {
        expect(await vestingWallet.callStatic.releaseDatePerToken(ETH_ADDRESS)).to.equal(RELEASE_DATE);
      });

      it('should update startDatePerToken', async () => {
        expect(await vestingWallet.callStatic.startDatePerToken(ETH_ADDRESS)).to.equal(START_DATE);
      });
    });

    context('when there was a previous benefit', () => {
      const NEW_START_DATE = START_DATE * 10;

      beforeEach(async () => {
        vestingWallet.setVariable('startDatePerToken', { [ETH_ADDRESS]: START_DATE });
        vestingWallet.setVariable('releaseDatePerToken', { [ETH_ADDRESS]: START_DATE + DURATION });
        vestingWallet.setVariable('amountPerToken', { [ETH_ADDRESS]: VEST_AMOUNT });
      });

      it('should overwrite start date', async () => {
        await vestingWallet.connect(owner)['addBenefit(uint64,uint64)'](NEW_START_DATE, DURATION, { value: VEST_AMOUNT });

        expect(await vestingWallet.startDatePerToken(ETH_ADDRESS)).to.eq(NEW_START_DATE);
      });

      it('should overwrite release date', async () => {
        await vestingWallet.connect(owner)['addBenefit(uint64,uint64)'](NEW_START_DATE, DURATION, { value: VEST_AMOUNT });

        expect(await vestingWallet.releaseDatePerToken(ETH_ADDRESS)).to.eq(NEW_START_DATE + DURATION);
      });

      context('when previous benefit has not yet started', () => {
        it('should add previous amount to new benefit', async () => {
          await vestingWallet.connect(owner)['addBenefit(uint64,uint64)'](NEW_START_DATE, DURATION, { value: VEST_AMOUNT });

          expect(await vestingWallet.amountPerToken(ETH_ADDRESS)).to.eq(VEST_AMOUNT.mul(2));
        });
      });

      context('when previous benefit is ongoing', () => {
        const PARTIAL_PROPORTION = 3;
        let timestamp: number;
        let partialDuration: number;
        let partialBenefit: BigNumber;

        beforeEach(async () => {
          await evm.advanceToTimeAndBlock(START_DATE + DURATION / PARTIAL_PROPORTION);
          await vestingWallet.connect(owner)['addBenefit(uint64,uint64)'](NEW_START_DATE, DURATION, { value: VEST_AMOUNT });
          // query latest block timestamp for precise calculation
          timestamp = (await ethers.provider.getBlock('latest')).timestamp;
          partialDuration = timestamp - START_DATE;
          partialBenefit = VEST_AMOUNT.mul(partialDuration).div(DURATION);
        });

        it('should release ongoing benefit', async () => {
          expect(await ethers.provider.getBalance(beneficiary)).to.eq(partialBenefit);
        });

        it('should add remaining amount to new benefit', async () => {
          expect(await vestingWallet.amountPerToken(ETH_ADDRESS)).to.eq(VEST_AMOUNT.add(VEST_AMOUNT.sub(partialBenefit)));
        });
      });

      context('when previous benefit has ended', () => {
        beforeEach(async () => {
          await evm.advanceToTimeAndBlock(START_DATE + DURATION);
          await vestingWallet.connect(owner)['addBenefit(uint64,uint64)'](NEW_START_DATE, DURATION, { value: VEST_AMOUNT });
        });

        it('should release all previous benefit', async () => {
          expect(await ethers.provider.getBalance(beneficiary)).to.eq(VEST_AMOUNT);
        });

        it('should not add any amount to new benefit', async () => {
          expect(await vestingWallet.amountPerToken(ETH_ADDRESS)).to.eq(VEST_AMOUNT);
        });
      });
    });
  });

  describe('removeBenefit(address)', () => {
    behaviours.onlyOwner(() => vestingWallet, 'removeBenefit(address)', owner, [DAI_ADDRESS]);

    beforeEach(async () => {
      vestingWallet.setVariable('startDatePerToken', { [DAI_ADDRESS]: START_DATE });
      vestingWallet.setVariable('releaseDatePerToken', { [DAI_ADDRESS]: START_DATE + DURATION });
      vestingWallet.setVariable('amountPerToken', { [DAI_ADDRESS]: VEST_AMOUNT });
    });

    it('should revert if transfer fails', async () => {
      dai.transfer.reverts();

      await expect(vestingWallet.connect(owner)['removeBenefit(address)'](DAI_ADDRESS)).to.be.revertedWith('SafeERC20: low-level call failed');
    });

    it('should revert if transfer does not succeed', async () => {
      dai.transfer.returns(false);

      await expect(vestingWallet.connect(owner)['removeBenefit(address)'](DAI_ADDRESS)).to.be.revertedWith(
        'SafeERC20: ERC20 operation did not succeed'
      );
    });

    context('when vesting period has not yet started', () => {
      beforeEach(async () => {
        dai.transfer.reset();
        dai.transfer.returns(true);

        await evm.advanceToTime(START_DATE - 1);
      });

      it('should transfer all vested tokens to owner', async () => {
        await vestingWallet.connect(owner)['removeBenefit(address)'](DAI_ADDRESS);
        expect(dai.transfer).to.have.been.calledWith(owner.address, VEST_AMOUNT);
      });
    });

    context('when vesting period is ongoing', () => {
      const PARTIAL_PROPORTION = 3;
      let timestamp: number;
      let partialDuration: number;

      beforeEach(async () => {
        dai.transfer.reset();
        dai.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION / PARTIAL_PROPORTION);
        await vestingWallet.connect(owner)['removeBenefit(address)'](DAI_ADDRESS);

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
        dai.transfer.reset();
        dai.transfer.returns(true);

        await evm.advanceToTimeAndBlock(START_DATE + DURATION);
        await vestingWallet.connect(owner)['removeBenefit(address)'](DAI_ADDRESS);
      });

      it('should transfer total ERC20 amount to beneficiary', async () => {
        expect(dai.transfer).to.have.been.calledWith(beneficiary, VEST_AMOUNT);
      });
    });
  });

  describe('removeBenefit()', () => {
    behaviours.onlyOwner(() => vestingWallet, 'removeBenefit()', owner, []);

    let gasPrice: BigNumber;
    let gasUsed: BigNumber;
    let gasCost: BigNumber;

    beforeEach(async () => {
      contracts.setBalance(vestingWallet.address, VEST_AMOUNT);

      vestingWallet.setVariable('startDatePerToken', { [ETH_ADDRESS]: START_DATE });
      vestingWallet.setVariable('releaseDatePerToken', { [ETH_ADDRESS]: START_DATE + DURATION });
      vestingWallet.setVariable('amountPerToken', { [ETH_ADDRESS]: VEST_AMOUNT });
    });

    context('when vesting period has not yet started', () => {
      beforeEach(async () => {
        await evm.advanceToTime(START_DATE - 1);
      });

      it('should transfer all ETH to owner', async () => {
        const beforeBalance = await ethers.provider.getBalance(owner.address);
        const tx = await vestingWallet.connect(owner)['removeBenefit()']();
        gasPrice = (await tx.wait()).effectiveGasPrice;
        gasUsed = (await tx.wait()).gasUsed;
        gasCost = gasPrice.mul(gasUsed);

        const afterBalance = await ethers.provider.getBalance(owner.address);

        expect(afterBalance).to.be.eq(beforeBalance.add(VEST_AMOUNT).sub(gasCost));
      });
    });

    context('when vesting period is ongoing', () => {
      const PARTIAL_PROPORTION = 3;
      let timestamp: number;
      let partialDuration: number;
      let beforeBalance: BigNumber;

      beforeEach(async () => {
        beforeBalance = await ethers.provider.getBalance(owner.address);
        await evm.advanceToTimeAndBlock(START_DATE + DURATION / PARTIAL_PROPORTION);
        const tx = await vestingWallet.connect(owner)['removeBenefit()']();
        gasPrice = (await tx.wait()).effectiveGasPrice;
        gasUsed = (await tx.wait()).gasUsed;
        gasCost = gasPrice.mul(gasUsed);

        // query latest block timestamp for precise calculation
        timestamp = (await ethers.provider.getBlock('latest')).timestamp;
        partialDuration = timestamp - START_DATE;
      });

      it('should transfer releaseable ETH amount to beneficiary', async () => {
        const beneficiaryBalance = await ethers.provider.getBalance(beneficiary);
        expect(beneficiaryBalance).to.be.eq(VEST_AMOUNT.mul(partialDuration).div(DURATION));
      });

      it('should transfer remaining ETH amount to owner', async () => {
        const afterBalance = await ethers.provider.getBalance(owner.address);
        expect(afterBalance.sub(beforeBalance)).to.be.eq(VEST_AMOUNT.sub(VEST_AMOUNT.mul(partialDuration).div(DURATION)).sub(gasCost));
      });
    });

    context('when vesting period has ended', () => {
      beforeEach(async () => {
        await evm.advanceToTimeAndBlock(START_DATE + DURATION);
        await vestingWallet.connect(owner)['removeBenefit()']();

        it('should transfer total ETH amount to beneficiary', async () => {
          const beneficiaryBalance = await ethers.provider.getBalance(beneficiary);
          expect(beneficiaryBalance).to.be.eq(VEST_AMOUNT);
        });
      });
    });
  });

  describe('sendDust(address)', () => {
    const TEN_DAIs = toUnit(10);

    behaviours.onlyOwner(() => vestingWallet, 'sendDust(address)', owner, [DAI_ADDRESS]);

    it('should revert if the address is neither an ERC20 nor ETH', async () => {
      await expect(vestingWallet.connect(owner)['sendDust(address)'](wallet.generateRandomAddress())).to.be.reverted;
    });

    it('should revert if transfer fails', async () => {
      dai.transfer.returns(false);

      await expect(vestingWallet.connect(owner)['sendDust(address)'](DAI_ADDRESS)).to.be.revertedWith(
        'SafeERC20: ERC20 operation did not succeed'
      );
    });

    it('should call the transfer with the correct arguments', async () => {
      dai.transfer.returns(true);
      dai.balanceOf.returns(TEN_DAIs);
      await vestingWallet.connect(owner)['sendDust(address)'](DAI_ADDRESS);
      expect(dai.transfer).to.have.been.calledWith(owner.address, TEN_DAIs);
    });

    it('should emit an event', async () => {
      await expect(vestingWallet.connect(owner)['sendDust(address)'](DAI_ADDRESS))
        .to.emit(vestingWallet, 'DustSent')
        .withArgs(DAI_ADDRESS, TEN_DAIs, owner.address);
    });
  });

  describe('sendDust()', () => {
    const ONE_ETH = toUnit(1);

    behaviours.onlyOwner(() => vestingWallet, 'sendDust()', owner, []);

    beforeEach(async () => {
      await contracts.setBalance(vestingWallet.address, ONE_ETH);
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

    it('should be equivalent to use sendDust(address) with ETH address', async () => {
      const initialBalance = await owner.getBalance();
      const tx = await vestingWallet.connect(owner)['sendDust(address)'](ETH_ADDRESS);

      const gasUsed = (await tx.wait()).gasUsed;
      const gasPrice = (await tx.wait()).effectiveGasPrice;
      const gasCost = gasUsed.mul(gasPrice).toNumber();

      const finalBalance = await owner.getBalance();

      expect(finalBalance.sub(initialBalance)).to.equal(ONE_ETH.sub(gasCost));
    });

    it('should emit an event', async () => {
      await expect(vestingWallet.connect(owner)['sendDust()']())
        .to.emit(vestingWallet, 'DustSent')
        .withArgs(ETH_ADDRESS, ONE_ETH, owner.address);
    });
  });
});

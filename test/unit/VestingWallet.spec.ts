import { IERC20 } from '@typechained';
import { toUnit } from '@utils/bn';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { ethers } from 'hardhat';
import { VestingWallet, VestingWallet__factory } from '@typechained';
import { evm } from '@utils';
import { DAI_ADDRESS, DURATION, ETH_ADDRESS, NON_ZERO, PARTIAL_DURATION, START_DATE, VEST_AMOUNT } from '@utils/constants';
import { FakeContract, MockContract, MockContractFactory, smock } from '@defi-wonderland/smock';
import chai, { expect } from 'chai';

chai.use(smock.matchers);

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
    dai = await smock.fake('ERC20', { address: DAI_ADDRESS });

    snapshotId = await evm.snapshot.take();
  });

  beforeEach(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  after(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  it('should set the beneficiary address', async () => {
    expect(await vestingWallet.beneficiary()).to.equal(NON_ZERO);
  });

  describe('vestedAmount', () => {
    context('using ERC20', () => {
      beforeEach(async () => {
        dai.transferFrom.reset();
        dai.transferFrom.returns(true);

        await vestingWallet.connect(owner)['addBenefit(uint64,uint64,address,uint256)'](START_DATE, DURATION, DAI_ADDRESS, VEST_AMOUNT);
      });

      it('should return 0 if vest has not yet started', async () => {
        await evm.advanceToTimeAndBlock(START_DATE - 1);
        expect(await vestingWallet['vestedAmount(address)'](DAI_ADDRESS)).to.be.eq(0);
      });

      it('should return total bonds if vest has finalized', async () => {
        await evm.advanceToTimeAndBlock(START_DATE + DURATION + 1);
        expect(await vestingWallet['vestedAmount(address)'](DAI_ADDRESS)).to.be.eq(VEST_AMOUNT);
      });

      it('should return a partial amount if vest is ongoing', async () => {
        await evm.advanceToTimeAndBlock(START_DATE + PARTIAL_DURATION);
        expect(await vestingWallet['vestedAmount(address)'](DAI_ADDRESS)).to.be.eq(VEST_AMOUNT.mul(PARTIAL_DURATION).div(DURATION));
      });
    });

    context('using ETH', () => {
      beforeEach(async () => {
        await vestingWallet.connect(owner)['addBenefit(uint64,uint64)'](START_DATE, DURATION, { value: VEST_AMOUNT });
      });

      it('should return 0 if vest has not yet started', async () => {
        await evm.advanceToTimeAndBlock(START_DATE - 1);
        expect(await vestingWallet['vestedAmount()']()).to.be.eq(0);
      });

      it('should return total bonds if vest has finalized', async () => {
        await evm.advanceToTimeAndBlock(START_DATE + DURATION + 1);
        expect(await vestingWallet['vestedAmount()']()).to.be.eq(VEST_AMOUNT);
      });

      it('should return a partial amount if vest is ongoing', async () => {
        await evm.advanceToTimeAndBlock(START_DATE + PARTIAL_DURATION);
        expect(await vestingWallet['vestedAmount()']()).to.be.eq(VEST_AMOUNT.mul(PARTIAL_DURATION).div(DURATION));
      });

      it('should be able to use ETH address', async () => {
        await evm.advanceToTimeAndBlock(START_DATE + DURATION);
        expect(await vestingWallet['vestedAmount(address)'](ETH_ADDRESS)).to.be.eq(VEST_AMOUNT);
      });
    });
  });

  describe('addBenefit', () => {
    const RELEASE_DATE = START_DATE + DURATION;

    context('when owner creates a ERC20 bond', () => {
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

    context('when owner creates a ETH bond', () => {
      const ETH_VEST_AMOUNT = toUnit(8);

      beforeEach(async () => {
        await vestingWallet.connect(owner)['addBenefit(uint64,uint64)'](START_DATE, DURATION, {
          value: ETH_VEST_AMOUNT,
        });
      });

      it('should transfer the token to the contract', async () => {
        expect(await vestingWallet.provider.getBalance(vestingWallet.address)).to.equal(ETH_VEST_AMOUNT);
      });

      it('should update amountPerToken', async () => {
        expect(await vestingWallet.callStatic.amountPerToken(ETH_ADDRESS)).to.equal(ETH_VEST_AMOUNT);
      });

      it('should update releaseDatePerToken', async () => {
        expect(await vestingWallet.callStatic.releaseDatePerToken(ETH_ADDRESS)).to.equal(RELEASE_DATE);
      });

      it('should update startDatePerToken', async () => {
        expect(await vestingWallet.callStatic.startDatePerToken(ETH_ADDRESS)).to.equal(START_DATE);
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
        await expect(vestingWallet.connect(owner)['sendDust()']())
          .to.emit(vestingWallet, 'DustSent')
          .withArgs(ETH_ADDRESS, ONE_ETH, owner.address);
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

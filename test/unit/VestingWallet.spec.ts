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
  let vestingWallet: VestingWallet;
  let vestingWalletFactory: VestingWallet__factory;
  let snapshotId: string;
  let beneficiary: SignerWithAddress;
  let owner: SignerWithAddress;
  let dai: FakeContract<IERC20>;

  before(async () => {
    [beneficiary, owner] = await ethers.getSigners();
    // TODO: replace for a Mock (we use mocks in unit tests)
    vestingWalletFactory = (await ethers.getContractFactory('VestingWallet')) as VestingWallet__factory;
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

  describe('addBenefit', async () => {
    const timestamp = (await ethers.provider.getBlock('latest')).timestamp;
    const startDate = BigNumber.from(Math.floor(timestamp / 1000));
    const duration = BigNumber.from(60 * 60 * 24 * 3); // 3 months
    const releaseDate = startDate.add(duration);

    context('when owner creates a ERC20 bond', async () => {
      beforeEach(async () => {
        await evm.snapshot.revert(snapshotId);
        dai.transfer.reset();
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

    context('when owner creates a ETH bond', async () => {
      const ETH_VEST_AMOUNT = toUnit(8);

      beforeEach(async () => {
        await evm.snapshot.revert(snapshotId);
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
});

import { MockContract, MockContractFactory, smock } from '@defi-wonderland/smock';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { VestingWallet, VestingWallet__factory } from '@typechained';
import { behaviours, wallet } from '@utils';
import { ZERO_ADDRESS } from '@utils/constants';
import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('Governable', () => {
  let owner: SignerWithAddress;
  let governance: SignerWithAddress;
  let pendingGovernance: SignerWithAddress;
  let vestingWalletFactory: MockContractFactory<VestingWallet__factory>;

  const randomAddress = wallet.generateRandomAddress();

  before(async () => {
    [owner, governance, pendingGovernance] = await ethers.getSigners();
    vestingWalletFactory = await smock.mock<VestingWallet__factory>('VestingWallet');
  });

  describe('constructor', () => {
    it('should revert when given zero address', async () => {
      await expect(vestingWalletFactory.deploy(ZERO_ADDRESS)).to.be.revertedWith('NoGovernanceZeroAddress()');
    });
  });

  context('after deployed', () => {
    let vestingWallet: MockContract<VestingWallet>;

    beforeEach(async () => {
      vestingWallet = await vestingWalletFactory.deploy(governance.address);
    });

    describe('setGovernance', () => {
      behaviours.onlyGovernance(() => vestingWallet, 'setGovernance', governance, [randomAddress]);

      it('should set pendingGovernance', async () => {
        await vestingWallet.connect(governance).setGovernance(randomAddress);
        expect(await vestingWallet.pendingGovernance()).to.be.eq(randomAddress);
      });

      it('should emit event', async () => {
        const tx = await vestingWallet.connect(governance).setGovernance(randomAddress);
        await expect(tx).to.emit(vestingWallet, 'GovernanceProposal').withArgs(randomAddress);
      });
    });

    describe('acceptGovernance', () => {
      beforeEach(async () => {
        await vestingWallet.setVariable('pendingGovernance', pendingGovernance.address);
      });

      behaviours.onlyPendingGovernance(() => vestingWallet, 'acceptGovernance', pendingGovernance, []);

      it('should set governance', async () => {
        await vestingWallet.connect(pendingGovernance).acceptGovernance();
        expect(await vestingWallet.governance()).to.be.eq(pendingGovernance.address);
      });

      it('should remove pending governance', async () => {
        await vestingWallet.connect(pendingGovernance).acceptGovernance();
        expect(await vestingWallet.pendingGovernance()).to.be.eq(ZERO_ADDRESS);
      });

      it('should emit event', async () => {
        const tx = await vestingWallet.connect(pendingGovernance).acceptGovernance();
        await expect(tx).to.emit(vestingWallet, 'GovernanceSet').withArgs(pendingGovernance.address);
      });
    });
  });
});

import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { shouldVerifyContract } from '../utils/deploy';

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const deploy = await hre.deployments.deploy('VestingWallet', {
    contract: 'contracts/VestingWallet.sol:VestingWallet',
    from: deployer,
    args: [deployer],
    log: true,
  });

  if (await shouldVerifyContract(deploy)) {
    await hre.run('verify:verify', {
      address: deploy.address,
      constructorArguments: [deployer],
    });
  }
};
deployFunction.dependencies = [];
deployFunction.tags = ['VestingWallet'];
export default deployFunction;

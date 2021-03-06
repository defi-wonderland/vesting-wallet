import { toUnit } from './bn';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const DAI_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
export const WETH_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F'; // fix for weth
export const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
export const DAI_WHALE_ADDRESS = '0x16463c0fdB6BA9618909F5b120ea1581618C1b9E';
export const USDC_WHALE_ADDRESS = '0xe2644b0dc1b96c101d95421e95789ef6992b0e6a';
export const VEST_AMOUNT = toUnit(100);
export const VEST_AMOUNT_6_DECIMALS = '0x5F5E100';
export const START_DATE = 100_000_000_000; // timestamp in the future
export const DURATION = 1_000_000;
export const PARTIAL_DURATION = 700_000;
export const EXPECTATION_DELTA = toUnit(0.0003).toNumber();

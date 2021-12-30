import { toUnit } from './bn';

export const DAI_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
export const DAI_WHALE_ADDRESS = '0x16463c0fdB6BA9618909F5b120ea1581618C1b9E';
export const ETH_ADDRESS = '0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF';
export const NON_ZERO = '0x0000000000000000000000000000000000000001';
export const VEST_AMOUNT = toUnit(100);
export const START_DATE = 100_000_000_000; // timestamp in the future
export const DURATION = 1_000_000;
export const PARTIAL_DURATION = 700_000;
export const EXPECTATION_DELTA = toUnit(0.0003).toNumber();

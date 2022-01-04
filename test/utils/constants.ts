import { toUnit } from './bn';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const DAI_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
export const USD_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
export const DAI_WHALE_ADDRESS = '0x16463c0fdB6BA9618909F5b120ea1581618C1b9E';
export const USD_WHALE_ADDRESS = '0x7e0188b0312a26ffe64b7e43a7a91d430fb20673';
export const VEST_AMOUNT = toUnit(100);
export const START_DATE = 100_000_000_000; // timestamp in the future
export const DURATION = 1_000_000;
export const PARTIAL_DURATION = 700_000;
export const EXPECTATION_DELTA = toUnit(0.0003).toNumber();

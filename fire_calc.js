/**
 * Estimates fractional years to reach a target balance with a given probability.
 *
 * @param {number} startingBalance - Initial balance.
 * @param {number} monthlyDeposit - Monthly deposit amount.
 * @param {number} annualReturn - Expected annual rate of return (e.g., 0.07 for 7%).
 * @param {number} annualStdDev - Annual standard deviation of returns (e.g., 0.15).
 * @param {number} targetBalance - Target future value.
 * @param {number} successRate - Required probability of success (e.g., 0.9 = 90%).
 * @param {number} [maxYears=100] - Max years to simulate.
 * @return {[number, number]} [fractional years to reach target, average ending balance of successful runs]
 * @customfunction
 */
function estimateYearsToTarget(
  startingBalance,
  monthlyDeposit,
  annualReturn,
  annualStdDev,
  targetBalance,
  successRate = 0.9,
  maxYears = 100
) {
  const SIMULATIONS = 1000;
  const MONTHS_IN_YEAR = 12;
  const MONTHLY_RETURN_MEAN = Math.pow(1 + annualReturn, 1 / MONTHS_IN_YEAR) - 1;
  const MONTHLY_STD_DEV = Math.pow(1 + annualStdDev, 1 / MONTHS_IN_YEAR) - 1;

  function randomNormal() {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }

  for (let months = 1; months <= maxYears * MONTHS_IN_YEAR; months++) {
    let successes = 0;
    let balances = [];

    for (let sim = 0; sim < SIMULATIONS; sim++) {
      let balance = startingBalance;

      for (let m = 0; m < months; m++) {
        const r = MONTHLY_RETURN_MEAN + MONTHLY_STD_DEV * randomNormal();
        balance = balance * (1 + r) + monthlyDeposit;
      }

      if (balance >= targetBalance) {
        successes++;
        balances.push(balance);
      }
    }

    if (successes / SIMULATIONS >= successRate) {
      const avgBalance = balances.reduce((a, b) => a + b, 0) / balances.length;
      return [months / MONTHS_IN_YEAR, avgBalance];
    }
  }

  return [-1, 0]; // Could not reach target within maxYears
}

/**
 * Returns [depositYears, averageBalanceAtRetirement] to sustain withdrawals until age 95 with given success rate.
 *
 * @param {number} startingBalance - Initial investment balance.
 * @param {number} monthlyDeposit - Amount deposited each month before retirement.
 * @param {number} annualReturn - Expected annual rate of return (e.g., 0.07).
 * @param {number} annualStdDev - Annual standard deviation of returns (e.g., 0.15).
 * @param {number} monthlyWithdrawal - Amount withdrawn monthly after deposits stop.
 * @param {number} currentAge - Current age of the individual.
 * @param {number} [successRate=0.9] - Desired probability of not running out of money.
 * @param {number} [maxYears=60] - Maximum deposit years to consider.
 * @return {[number, number]} [Fractional deposit years, Average balance at retirement (successful cases only)]
 * @customfunction
 */
function estimateDepositYearsToSustainWithdrawals(
  startingBalance,
  monthlyDeposit,
  annualReturn,
  annualStdDev,
  monthlyWithdrawal,
  currentAge,
  successRate = 0.9,
  maxYears = 60
) {
  const SIMULATIONS = 1000;
  const MONTHS_IN_YEAR = 12;
  const RETIREMENT_END_AGE = 95;
  const MONTHLY_RETURN_MEAN = Math.pow(1 + annualReturn, 1 / MONTHS_IN_YEAR) - 1;
  const MONTHLY_STD_DEV = Math.pow(1 + annualStdDev, 1 / MONTHS_IN_YEAR) - 1;

  function randomNormal() {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  }

  for (let depositMonths = 0; depositMonths <= maxYears * MONTHS_IN_YEAR; depositMonths++) {
    const retirementMonths = (RETIREMENT_END_AGE - currentAge) * MONTHS_IN_YEAR - depositMonths;
    if (retirementMonths <= 0) return -1;

    let successes = 0;
    let retirementBalances = [];

    for (let sim = 0; sim < SIMULATIONS; sim++) {
      let balance = startingBalance;

      // Accumulation phase
      for (let m = 0; m < depositMonths; m++) {
        const r = MONTHLY_RETURN_MEAN + MONTHLY_STD_DEV * randomNormal();
        balance = balance * (1 + r) + monthlyDeposit;
      }

      // Retirement phase
      let tempBalance = balance;
      let success = true;
      for (let m = 0; m < retirementMonths; m++) {
        const r = MONTHLY_RETURN_MEAN + MONTHLY_STD_DEV * randomNormal();
        tempBalance = tempBalance * (1 + r) - monthlyWithdrawal;
        if (tempBalance < 0) {
          success = false;
          break;
        }
      }

      if (success) {
        successes++;
        retirementBalances.push(balance); // record balance at retirement
      }
    }

    if (successes / SIMULATIONS >= successRate) {
      const avgBalance = retirementBalances.reduce((a, b) => a + b, 0) / retirementBalances.length;
      return [depositMonths / MONTHS_IN_YEAR, avgBalance];
    }
  }

  return [-1, 0]; // no solution found within maxYears
}

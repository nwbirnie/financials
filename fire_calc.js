/**
 * Calculates months of saving needed to sustain withdrawal rate until age 95
 * Uses Monte Carlo simulation with separate pension and tax-free accounts
 * 
 * @customfunction
 * @param {number} pensionBalance - Initial pension balance (taxed on withdrawal)
 * @param {number} taxFreeBalance - Initial tax-free balance (ISA, etc.)
 * @param {number} monthlyPensionSavings - Monthly pension contributions
 * @param {number} monthlyTaxFreeSavings - Monthly tax-free savings
 * @param {number} annualReturn - Expected annual rate of return (as decimal, e.g., 0.07 for 7%)
 * @param {number} returnStdDev - Standard deviation of annual returns (as decimal)
 * @param {number} monthlyWithdrawalNeeded - Monthly net income needed (after tax)
 * @param {number} currentAge - Current age
 * @param {number} targetSuccessRate - Target success rate (as decimal, e.g., 0.9 for 90%)
 * @param {number} maxSavingMonths - Maximum months to test (default: 600 = 50 years)
 * @param {number} simulations - Number of Monte Carlo simulations (default: 1000)
 * @returns {number} Months of saving needed, or -1 if not achievable
 */
function calculateSavingMonthsForRetirement(
  pensionBalance,
  taxFreeBalance,
  monthlyPensionSavings,
  monthlyTaxFreeSavings,
  annualReturn,
  returnStdDev,
  monthlyWithdrawalNeeded,
  currentAge,
  targetSuccessRate = 0.9,
  maxSavingMonths = 600,
  simulations = 1000
) {
  
  // Enhanced input validation
  if (currentAge >= 95) {
    throw new Error("Current age must be less than 95");
  }
  if (currentAge < 18) {
    throw new Error("Current age must be at least 18");
  }
  if (targetSuccessRate <= 0 || targetSuccessRate > 1) {
    throw new Error("Target success rate must be between 0 and 1");
  }
  if (annualReturn < -0.5 || annualReturn > 0.5) {
    throw new Error("Annual return must be between -50% and 50%");
  }
  if (returnStdDev < 0 || returnStdDev > 1) {
    throw new Error("Return standard deviation must be between 0 and 100%");
  }
  if (monthlyWithdrawalNeeded <= 0) {
    throw new Error("Monthly withdrawal needed must be positive");
  }
  if (pensionBalance < 0 || taxFreeBalance < 0) {
    throw new Error("Account balances cannot be negative");
  }
  if (monthlyPensionSavings < 0 || monthlyTaxFreeSavings < 0) {
    throw new Error("Monthly savings cannot be negative");
  }
  
  // UK Income Tax settings (2024/25 tax year)
  const defaultTaxSettings = {
    personalAllowance: 12570,      // Personal allowance
    basicRateThreshold: 37700,     // Basic rate band (£12,570 - £50,270)
    higherRateThreshold: 125140,   // Higher rate band (£50,270 - £125,140)
    basicRate: 0.20,               // 20% basic rate
    higherRate: 0.40,              // 40% higher rate
    additionalRate: 0.45,          // 45% additional rate (over £125,140)
    personalAllowanceTaperThreshold: 100000, // PA starts tapering at £100k
    personalAllowanceTaperRate: 0.5 // PA reduces by £1 for every £2 over threshold
  };
  
  const tax = defaultTaxSettings;
  
  // Enhanced constants for UK pension rules  
  const UK_PENSION_ACCESS_AGE = 58; // Pension access age and strategy switch age
  const WITHDRAWAL_TOLERANCE = 0.02; // 2% tolerance for withdrawal accuracy
  
  const monthsToAge95 = (95 - currentAge) * 12;
  const monthlyReturn = annualReturn / 12;
  const monthlyStdDev = returnStdDev / Math.sqrt(12);
  
    /**
   * Calculate UK income tax on annual income
   * @param {number} grossAnnualIncome - Gross annual income
   * @returns {number} Annual income tax due
   */
  function calculateUKIncomeTax(grossAnnualIncome) {
    if (grossAnnualIncome <= 0) return 0;
    
    // Calculate personal allowance (tapers above £100k)
    let personalAllowance = tax.personalAllowance;
    if (grossAnnualIncome > tax.personalAllowanceTaperThreshold) {
      const excessIncome = grossAnnualIncome - tax.personalAllowanceTaperThreshold;
      const allowanceReduction = Math.min(personalAllowance, excessIncome * tax.personalAllowanceTaperRate);
      personalAllowance = Math.max(0, personalAllowance - allowanceReduction);
    }
    
    // Calculate taxable income
    const taxableIncome = Math.max(0, grossAnnualIncome - personalAllowance);
    let incomeTax = 0;
    
    if (taxableIncome <= tax.basicRateThreshold) {
      // Basic rate only
      incomeTax = taxableIncome * tax.basicRate;
    } else if (taxableIncome <= tax.higherRateThreshold - tax.personalAllowance) {
      // Basic rate + higher rate
      incomeTax = (tax.basicRateThreshold * tax.basicRate) + 
                  ((taxableIncome - tax.basicRateThreshold) * tax.higherRate);
    } else {
      // Basic rate + higher rate + additional rate
      const higherRateBand = tax.higherRateThreshold - tax.personalAllowance - tax.basicRateThreshold;
      incomeTax = (tax.basicRateThreshold * tax.basicRate) + 
                  (higherRateBand * tax.higherRate) +
                  ((taxableIncome - tax.basicRateThreshold - higherRateBand) * tax.additionalRate);
    }
    
    return incomeTax;
  }
  
  /**
   * Calculate optimal withdrawal strategy based on age and account balances
   * Before age 58: Tax-free first (simulation fails if depleted before 58)
   * After age 58: Pension first for tax efficiency
   * @param {number} pensionBalance - Current pension balance
   * @param {number} taxFreeBalance - Current tax-free balance
   * @param {number} targetNetIncome - Required net income
   * @param {number} currentRetirementAge - Current age in retirement
   * @returns {Object} Withdrawal amounts and tax details
   */
  function calculateOptimalWithdrawal(pensionBalance, taxFreeBalance, targetNetIncome, currentRetirementAge) {
    let taxFreeWithdrawal = 0;
    let pensionWithdrawal = 0;
    let totalTax = 0;
    
    // Ensure inputs are valid
    if (pensionBalance < 0) pensionBalance = 0;
    if (taxFreeBalance < 0) taxFreeBalance = 0;
    if (targetNetIncome <= 0) {
      return { 
        taxFreeWithdrawal: 0, 
        pensionWithdrawal: 0, 
        totalTax: 0, 
        netIncome: 0, 
        grossIncome: 0,
        ageBased: true
      };
    }
    
    // Age-based withdrawal strategy
    if (currentRetirementAge < UK_PENSION_ACCESS_AGE) {
      // Before age 58: Use tax-free first (pension not accessible)
      if (taxFreeBalance >= targetNetIncome) {
        taxFreeWithdrawal = targetNetIncome;
        return {
          taxFreeWithdrawal,
          pensionWithdrawal,
          totalTax,
          netIncome: targetNetIncome,
          grossIncome: targetNetIncome,
          ageBased: true,
          strategy: "tax-free-only"
        };
      }
      
      // Use all available tax-free money
      taxFreeWithdrawal = taxFreeBalance;
      const remainingNeeded = targetNetIncome - taxFreeWithdrawal;
      
      // Cannot access pension before age 58, so if tax-free insufficient, we fail
      if (remainingNeeded > 0) {
        // Return what we can provide, simulation will handle the shortfall
        return {
          taxFreeWithdrawal,
          pensionWithdrawal: 0,
          totalTax: 0,
          netIncome: taxFreeWithdrawal,
          grossIncome: taxFreeWithdrawal,
          ageBased: true,
          strategy: "tax-free-only"
        };
      }
      
    } else {
      // Age 58+: Prioritize pension withdrawals for tax efficiency
      const requiredPensionForFullAmount = calculateRequiredPensionWithdrawal(targetNetIncome, pensionBalance);
      
      if (requiredPensionForFullAmount <= pensionBalance) {
        // Can meet full target from pension
        pensionWithdrawal = requiredPensionForFullAmount;
        totalTax = calculateUKIncomeTax(pensionWithdrawal);
        return {
          taxFreeWithdrawal,
          pensionWithdrawal,
          totalTax,
          netIncome: targetNetIncome,
          grossIncome: pensionWithdrawal,
          ageBased: true,
          strategy: "pension-first"
        };
      } else {
        // Use all available pension first
        pensionWithdrawal = pensionBalance;
        totalTax = calculateUKIncomeTax(pensionWithdrawal);
        const netFromPension = pensionWithdrawal - totalTax;
        const remainingNeeded = targetNetIncome - netFromPension;
        
        // Use tax-free for remaining amount
        if (remainingNeeded > 0 && taxFreeBalance > 0) {
          taxFreeWithdrawal = Math.min(taxFreeBalance, remainingNeeded);
        }
      }
    }
    
    const actualNetIncome = taxFreeWithdrawal + (pensionWithdrawal - totalTax);
    
    return {
      taxFreeWithdrawal,
      pensionWithdrawal,
      totalTax,
      netIncome: actualNetIncome,
      grossIncome: taxFreeWithdrawal + pensionWithdrawal,
      ageBased: true,
      strategy: currentRetirementAge < UK_PENSION_ACCESS_AGE ? "tax-free-only" : "pension-first"
    };
  }
  
  /**
   * Helper function to calculate required pension withdrawal for target net income
   * @param {number} targetNetIncome - Required net income from pension
   * @param {number} maxPensionBalance - Maximum available pension balance
   * @returns {number} Required gross pension withdrawal
   */
  function calculateRequiredPensionWithdrawal(targetNetIncome, maxPensionBalance) {
    if (targetNetIncome <= 0) return 0;
    
    // Binary search with iteration limit
    let low = targetNetIncome;
    let high = Math.min(maxPensionBalance, targetNetIncome * 3);
    let iterations = 0;
    const maxIterations = 50;
    const tolerance = 0.01;
    
    while (high - low > tolerance && iterations < maxIterations) {
      const mid = (low + high) / 2;
      const tax = calculateUKIncomeTax(mid);
      const netFromPension = mid - tax;
      
      if (netFromPension < targetNetIncome) {
        low = mid;
      } else {
        high = mid;
      }
      iterations++;
    }
    
    return Math.min(maxPensionBalance, (low + high) / 2);
  }
  
    /**
   * Generates a random return using normal distribution approximation
   */
  function generateRandomReturn() {
    // Box-Muller transformation for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return monthlyReturn + (monthlyStdDev * z);
  }
  
  /**
   * Simulates one retirement scenario with age-based withdrawal strategy
   * @param {number} savingMonths - Months of saving before retirement
   * @returns {boolean} True if portfolio lasts until age 95
   */
  function simulateRetirement(savingMonths) {
    let pensionBal = pensionBalance;
    let taxFreeBal = taxFreeBalance;
    
    // Accumulation phase - save for specified months
    for (let month = 0; month < savingMonths; month++) {
      const monthlyReturn = generateRandomReturn(); // Fix: use random return, not constant
      pensionBal = pensionBal * (1 + monthlyReturn) + monthlyPensionSavings;
      taxFreeBal = taxFreeBal * (1 + monthlyReturn) + monthlyTaxFreeSavings;
    }
    
    // Withdrawal phase - from end of saving until age 95
    const withdrawalMonths = monthsToAge95 - savingMonths;
    const monthlyNetNeeded = monthlyWithdrawalNeeded;
    const retirementStartAge = currentAge + (savingMonths / 12);
    
    for (let month = 0; month < withdrawalMonths; month++) {
      const monthlyReturn = generateRandomReturn(); // Fix: use random return
      const currentRetirementAge = retirementStartAge + (month / 12);
      
      // Apply returns before withdrawal
      pensionBal = Math.max(0, pensionBal * (1 + monthlyReturn));
      taxFreeBal = Math.max(0, taxFreeBal * (1 + monthlyReturn));
      
      // Check critical rule: tax-free pot must not be empty before age 58
      if (currentRetirementAge < UK_PENSION_ACCESS_AGE && taxFreeBal <= 0) {
        return false; // Simulation fails - tax-free depleted before pension access age (58)
      }
      
      // Calculate age-based optimal withdrawal
      const withdrawal = calculateOptimalWithdrawal(
        pensionBal, 
        taxFreeBal, 
        monthlyNetNeeded, 
        currentRetirementAge
      );
      
      // Check if we can meet the withdrawal needs with improved tolerance
      if (withdrawal.netIncome < monthlyNetNeeded * (1 - WITHDRAWAL_TOLERANCE)) {
        return false; // Can't meet withdrawal needs
      }
      
      // Execute withdrawals
      pensionBal = Math.max(0, pensionBal - withdrawal.pensionWithdrawal);
      taxFreeBal = Math.max(0, taxFreeBal - withdrawal.taxFreeWithdrawal);
      
      // Early termination check - if both balances are depleted early
      if (pensionBal <= 0 && taxFreeBal <= 0 && month < withdrawalMonths - 1) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Tests a specific number of saving months
   * @param {number} savingMonths - Months to test
   * @returns {number} Success rate for this duration
   */
  function testSavingDuration(savingMonths) {
    if (savingMonths >= monthsToAge95) {
      return 0; // Can't save longer than time until age 95
    }
    
    let successes = 0;
    for (let i = 0; i < simulations; i++) {
      if (simulateRetirement(savingMonths)) {
        successes++;
      }
    }
    return successes / simulations;
  }
  
  // Binary search to find minimum months needed
  let low = 0;
  let high = Math.min(maxSavingMonths, monthsToAge95 - 12); // Leave at least 1 year for withdrawal
  let result = null;
  
  // First check if it's even possible
  const maxPossibleSuccessRate = testSavingDuration(high);
  if (maxPossibleSuccessRate < targetSuccessRate) {
    return {
      success: false,
      message: `Target success rate of ${(targetSuccessRate * 100).toFixed(1)}% not achievable. Maximum possible: ${(maxPossibleSuccessRate * 100).toFixed(1)}%`,
      maxPossibleSuccessRate: maxPossibleSuccessRate,
      monthsTested: high
    };
  }
  
  // Binary search for minimum months needed
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const successRate = testSavingDuration(mid);
    
    if (successRate >= targetSuccessRate) {
      result = {
        monthsNeeded: mid,
        achievedSuccessRate: successRate,
        yearsNeeded: (mid / 12).toFixed(1),
        retirementAge: currentAge + (mid / 12),
        withdrawalYears: ((monthsToAge95 - mid) / 12).toFixed(1)
      };
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  
  if (result) {
    // Run additional simulations for more precise statistics on final result
    const finalStats = testSavingDuration(result.monthsNeeded);
    
    // Calculate sample withdrawal strategy at retirement
    let finalPensionBal = pensionBalance;
    let finalTaxFreeBal = taxFreeBalance;
    const retirementStartAge = currentAge + (result.monthsNeeded / 12);
    
    for (let month = 0; month < result.monthsNeeded; month++) {
      finalPensionBal = finalPensionBal * (1 + monthlyReturn) + monthlyPensionSavings;
      finalTaxFreeBal = finalTaxFreeBal * (1 + monthlyReturn) + monthlyTaxFreeSavings;
    }
    
    const sampleWithdrawal = calculateOptimalWithdrawal(
      finalPensionBal, 
      finalTaxFreeBal, 
      monthlyWithdrawalNeeded, 
      retirementStartAge
    );
    return result.monthsNeeded;
    // return {
    //   success: true,
    //   monthsNeeded: result.monthsNeeded,
    //   yearsNeeded: parseFloat(result.yearsNeeded),
    //   retirementAge: result.retirementAge,
    //   withdrawalYears: parseFloat(result.withdrawalYears),
    //   achievedSuccessRate: finalStats,
    //   targetSuccessRate: targetSuccessRate,
    //   accountDetails: {
    //     startingPensionBalance: pensionBalance,
    //     startingTaxFreeBalance: taxFreeBalance,
    //     monthlyPensionSavings: monthlyPensionSavings,
    //     monthlyTaxFreeSavings: monthlyTaxFreeSavings,
    //     totalMonthlySavings: monthlyPensionSavings + monthlyTaxFreeSavings,
    //     projectedPensionBalance: finalPensionBal,
    //     projectedTaxFreeBalance: finalTaxFreeBal,
    //     totalProjectedBalance: finalPensionBal + finalTaxFreeBal
    //   },
    //   withdrawalStrategy: {
    //     targetNetMonthlyIncome: monthlyWithdrawalNeeded,
    //     retirementStartAge: retirementStartAge,
    //     withdrawalStrategy: retirementStartAge < UK_PENSION_ACCESS_AGE ? "Tax-free only (pre-58)" : "Pension first (58+)",
    //     sampleTaxFreeWithdrawal: sampleWithdrawal.taxFreeWithdrawal,
    //     samplePensionWithdrawal: sampleWithdrawal.pensionWithdrawal,
    //     sampleMonthlyTax: sampleWithdrawal.totalTax,
    //     sampleEffectiveTaxRate: sampleWithdrawal.pensionWithdrawal > 0 ? 
    //       ((sampleWithdrawal.totalTax / sampleWithdrawal.pensionWithdrawal) * 100).toFixed(1) + '%' : '0%'
    //   },
    //   summary: `Need to save for ${result.monthsNeeded} months (${result.yearsNeeded} years) to achieve ${(targetSuccessRate * 100).toFixed(1)}% success rate. Retirement at age ${result.retirementAge.toFixed(1)}. Total savings: £${(monthlyPensionSavings + monthlyTaxFreeSavings).toFixed(0)}/month (£${monthlyPensionSavings.toFixed(0)} pension + £${monthlyTaxFreeSavings.toFixed(0)} tax-free).`
    // };
  }
  
  return {
    success: false,
    message: "Unable to find a solution within the given constraints"
  };
}

/**
 * Example usage function - demonstrates dual account structure
 */
function exampleUsage() {
  try {
    const accounts = {
      pensionBalance: 75000,        // £75k in pension
      taxFreeBalance: 25000,        // £25k in ISA
      monthlyPensionSavings: 1200,  // £1200/month to pension
      monthlyTaxFreeSavings: 800    // £800/month to ISA
    };
    
    const result = calculateSavingMonthsForRetirement(
      accounts,
      0.07,     // Annual return: 7%
      0.15,     // Standard deviation: 15%
      3000,     // Monthly net income needed: £3,000
      30,       // Current age: 30
      0.9       // Target success rate: 90%
    );
    
    console.log(result);
    
    if (result.success) {
      console.log(`\nResult: ${result.summary}`);
      console.log(`Achieved success rate: ${(result.achievedSuccessRate * 100).toFixed(1)}%`);
      
      console.log(`\nAccount Details:`);
      console.log(`- Starting pension balance: £${result.accountDetails.startingPensionBalance.toLocaleString()}`);
      console.log(`- Starting tax-free balance: £${result.accountDetails.startingTaxFreeBalance.toLocaleString()}`);
      console.log(`- Projected pension balance at retirement: £${result.accountDetails.projectedPensionBalance.toFixed(0).toLocaleString()}`);
      console.log(`- Projected tax-free balance at retirement: £${result.accountDetails.projectedTaxFreeBalance.toFixed(0).toLocaleString()}`);
      console.log(`- Total projected balance: £${result.accountDetails.totalProjectedBalance.toFixed(0).toLocaleString()}`);
      
      console.log(`\nWithdrawal Strategy (sample month):`);
      console.log(`- Tax-free withdrawal: £${result.withdrawalStrategy.sampleTaxFreeWithdrawal.toFixed(0)}`);
      console.log(`- Pension withdrawal: £${result.withdrawalStrategy.samplePensionWithdrawal.toFixed(0)}`);
      console.log(`- Tax on pension withdrawal: £${result.withdrawalStrategy.sampleMonthlyTax.toFixed(0)}`);
      console.log(`- Effective tax rate: ${result.withdrawalStrategy.sampleEffectiveTaxRate}`);
    } else {
      console.log(`\nFailed: ${result.message}`);
    }
    
  } catch (error) {
    console.error("Error:", error.message);
  }
}

/**
 * Test single FIRE scenario
 */
function compareAccountStrategies() {
  const strategies = [
    {
      name: "FIRE",
      accounts: {
        pensionBalance: 460000,
        taxFreeBalance: 470000,
        monthlyPensionSavings: 4000,
        monthlyTaxFreeSavings: 4000
      }
    }
  ];
  
  console.log("=== Account Strategy Comparison ===");
  
  strategies.forEach(strategy => {
    console.log(`\n${strategy.name} Strategy:`);
    
    const result = calculateSavingMonthsForRetirement(
      strategy.accounts,
      0.07,     // 7% return
      0.15,     // 15% volatility
      3500,     // £3500 net monthly income
      35,       // Age 35
      0.9       // 90% success rate
    );
    
    if (result.success) {
      console.log(`- Years to save: ${result.yearsNeeded}`);
      console.log(`- Retirement age: ${result.retirementAge.toFixed(1)}`);
      console.log(`- Total balance at retirement: £${result.accountDetails.totalProjectedBalance.toFixed(0).toLocaleString()}`);
      console.log(`- Sample tax rate: ${result.withdrawalStrategy.sampleEffectiveTaxRate}`);
    } else {
      console.log(`- Strategy failed: ${result.message}`);
    }
  });
}

/**
 * Test the tax efficiency of the withdrawal strategy
 */
function testTaxEfficiency() {
  const accounts = {
    pensionBalance: 200000,
    taxFreeBalance: 100000,
    monthlyPensionSavings: 0,
    monthlyTaxFreeSavings: 0
  };
  
  // Test different income levels
  const incomeTests = [2000, 3000, 4000, 5000, 6000];
  
  console.log("=== Tax Efficiency Test ===");
  console.log("Monthly Net Income | Tax-Free Used | Pension Used | Tax Paid | Effective Rate");
  console.log("------------------|---------------|--------------|----------|---------------");
  
  incomeTests.forEach(income => {
    const result = calculateSavingMonthsForRetirement(
      accounts, 0.07, 0.15, income, 65, 0.9, 1, 1 // Minimal simulation for quick test
    );
    
    if (result.success) {
      const ws = result.withdrawalStrategy;
      console.log(`£${income.toString().padEnd(16)} | £${ws.sampleTaxFreeWithdrawal.toFixed(0).padEnd(12)} | £${ws.samplePensionWithdrawal.toFixed(0).padEnd(11)} | £${ws.sampleMonthlyTax.toFixed(0).padEnd(7)} | ${ws.sampleEffectiveTaxRate.padEnd(13)}`);
    }
  });
}

/**
 * Batch testing function - tests multiple scenarios with dual accounts
 */
function testMultipleScenarios() {
  const scenarios = [
    {
      name: "Young Professional",
      accounts: {
        pensionBalance: 25000,
        taxFreeBalance: 15000,
        monthlyPensionSavings: 800,
        monthlyTaxFreeSavings: 500
      },
      netMonthlyIncome: 2500,
      currentAge: 28
    },
    {
      name: "Mid-Career",
      accounts: {
        pensionBalance: 120000,
        taxFreeBalance: 60000,
        monthlyPensionSavings: 1500,
        monthlyTaxFreeSavings: 1000
      },
      netMonthlyIncome: 4000,
      currentAge: 40
    },
    {
      name: "Pre-Retirement",
      accounts: {
        pensionBalance: 400000,
        taxFreeBalance: 150000,
        monthlyPensionSavings: 2000,
        monthlyTaxFreeSavings: 500
      },
      netMonthlyIncome: 5000,
      currentAge: 55
    }
  ];
  
  scenarios.forEach(scenario => {
    console.log(`\n=== ${scenario.name} Scenario ===`);
    const result = calculateSavingMonthsForRetirement(
      scenario.accounts,
      0.07,
      0.15,
      scenario.netMonthlyIncome,
      scenario.currentAge,
      0.9
    );
    
    if (result.success) {
      console.log(result.summary);
      console.log(`Total projected balance: £${result.accountDetails.totalProjectedBalance.toFixed(0).toLocaleString()}`);
      console.log(`Sample effective tax rate: ${result.withdrawalStrategy.sampleEffectiveTaxRate}`);
    } else {
      console.log(result.message);
    }
  });

}

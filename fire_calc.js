/**
 * UK Retirement Calculator - Optimized for 30-second Google Sheets limit
 * 
 * Optimization Strategy:
 * 1. INSTANT FAIL any scenario with >4% withdrawal rate (no Monte Carlo)
 * 2. Standard binary search (no year skipping) for maximum accuracy
 * 3. Full simulations (1000) for borderline cases (2.5-4% withdrawal)
 * 4. Each Monte Carlo sim includes both accumulation and retirement randomness
 * 5. Returns EXPECTED portfolio values, not random outcomes
 * 
 * @customfunction
 */

// Single source of truth for constants
const UK_PENSION_ACCESS_AGE = 58;
const UK_STATE_PENSION_AGE = 68;
const UK_STATE_PENSION_MONTHLY_2024 = 915.40;
const UK_PENSION_TAX_FREE_PERCENT = 0.25;
const UK_PENSION_TAX_FREE_LIFETIME_LIMIT = 268275;
const WITHDRAWAL_TOLERANCE = 0.02;

/**
 * Single tax calculation function (bug fix: no more duplicates)
 */
function calculateUKIncomeTax(annualIncome) {
  const personalAllowance = 12570;
  const basicRateThreshold = 50270;
  const higherRateThreshold = 125140;
  
  if (annualIncome <= personalAllowance) return 0;
  
  let tax = 0;
  const taxableIncome = annualIncome - personalAllowance;
  
  // Basic rate: 20%
  if (taxableIncome <= (basicRateThreshold - personalAllowance)) {
    tax = taxableIncome * 0.20;
  } else {
    tax = (basicRateThreshold - personalAllowance) * 0.20;
    
    // Higher rate: 40%
    const higherRateIncome = Math.min(taxableIncome - (basicRateThreshold - personalAllowance),
                                    higherRateThreshold - basicRateThreshold);
    tax += higherRateIncome * 0.40;
    
    // Additional rate: 45%
    if (taxableIncome > (higherRateThreshold - personalAllowance)) {
      const additionalRateIncome = taxableIncome - (higherRateThreshold - personalAllowance);
      tax += additionalRateIncome * 0.45;
    }
  }
  
  return tax;
}

/**
 * Adaptive simulations focused on 4% threshold
 * Increase simulations for short accumulation periods to reduce variance
 */
function getAdaptiveSimulations(pensionBalance, taxFreeBalance, monthlyWithdrawalNeeded, baseSimulations, yearsToRetirement) {
  const totalBalance = pensionBalance + taxFreeBalance;
  const annualWithdrawal = monthlyWithdrawalNeeded * 12;
  const withdrawalRate = totalBalance > 0 ? annualWithdrawal / totalBalance : 1;
  
  // For very short accumulation periods, we need MORE simulations to reduce variance
  if (yearsToRetirement < 2) {
    console.log(`Short accumulation period (${yearsToRetirement.toFixed(1)} years), using maximum simulations`);
    return baseSimulations; // Always use full simulations for < 2 years
  }
  
  // We know >4% will be instant failed, so this is for ≤4% cases
  
  // Borderline cases (2.5-4%) - your sweet spot, need maximum accuracy
  if (withdrawalRate >= 0.025 && withdrawalRate <= 0.04) {
    return baseSimulations; // Full 1000 simulations
  }
  
  // Safe cases (< 2.5%) - can reduce moderately
  if (withdrawalRate < 0.02) {
    return Math.max(400, Math.floor(baseSimulations * 0.4)); // 400 simulations
  }
  
  if (withdrawalRate < 0.025) {
    return Math.max(600, Math.floor(baseSimulations * 0.6)); // 600 simulations
  }
  
  // Should not reach here (>4% is instant failed)
  return baseSimulations;
}

/**
 * Early exit optimized for scenarios that passed 4% threshold
 * Since >4% are instant failed, these are more likely to succeed
 */
function shouldExitEarly(successes, failures, totalSimulations, targetRate) {
  const completed = successes + failures;
  
  // Need minimum samples
  if (completed < 50) return false;
  
  const currentRate = successes / completed;
  
  // For scenarios that made it past 4% threshold, be more conservative
  // Only exit on very clear outcomes
  
  if (completed >= 100) {
    // Exit if clearly failing (but this is less likely since >4% already filtered)
    if (currentRate < targetRate * 0.5) return true;
    
    // Exit if clearly succeeding
    if (currentRate > targetRate * 1.2) return true;
  }
  
  if (completed >= 200) {
    const remaining = totalSimulations - completed;
    
    // Mathematical impossibility checks
    const worstPossibleRate = successes / totalSimulations;
    if (worstPossibleRate > targetRate * 1.05) return true;
    
    const bestPossibleRate = (successes + remaining) / totalSimulations;
    if (bestPossibleRate < targetRate * 0.95) return true;
  }
  
  return false;
}

/**
 * Main calculation function with 30-second optimizations
 * @customfunction
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
  inflationRate = 0.025,
  withdrawalStrategy = 1,
  essentialExpenseRatio = 0.7,
  useBondTent = false,
  maxSavingMonths = 600,
  simulations = 1000,
  bondReturnRate = 0.03,
  bondVolatility = 0.05,
  stockAllocRetirement = 0.6,
  stockAllocLater = 0.4,
  glidePeriodYears = 10
) {
  const startTime = Date.now();
  
  // Input validation
  if (pensionBalance < 0 || taxFreeBalance < 0) {
    throw new Error("Balances must be non-negative");
  }
  if (monthlyPensionSavings < 0 || monthlyTaxFreeSavings < 0) {
    throw new Error("Savings amounts must be non-negative");
  }
  if (annualReturn < -0.5 || annualReturn > 0.5) {
    throw new Error("Annual return must be between -50% and 50%");
  }
  if (returnStdDev < 0 || returnStdDev > 1) {
    throw new Error("Standard deviation must be between 0% and 100%");
  }
  if (monthlyWithdrawalNeeded <= 0) {
    throw new Error("Monthly withdrawal must be positive");
  }
  if (currentAge < 18 || currentAge > 90) {
    throw new Error("Current age must be between 18 and 90");
  }
  if (targetSuccessRate < 0.1 || targetSuccessRate > 1) {
    throw new Error("Success rate must be between 10% and 100%");
  }
  if (withdrawalStrategy < 1 || withdrawalStrategy > 4) {
    throw new Error("Withdrawal strategy must be 1-4");
  }
  if (useBondTent) {
    if (bondReturnRate < 0 || bondReturnRate > 0.2) {
      throw new Error("Bond return rate must be between 0% and 20%");
    }
    if (bondVolatility < 0 || bondVolatility > 0.5) {
      throw new Error("Bond volatility must be between 0% and 50%");
    }
    if (stockAllocRetirement < 0 || stockAllocRetirement > 1) {
      throw new Error("Stock allocation at retirement must be between 0 and 1");
    }
    if (stockAllocLater < 0 || stockAllocLater > 1) {
      throw new Error("Stock allocation in later years must be between 0 and 1");
    }
    if (glidePeriodYears < 0 || glidePeriodYears > 30) {
      throw new Error("Glide period must be between 0 and 30 years");
    }
  }

  const monthsToAge95 = (95 - currentAge) * 12;
  const monthlyReturn = annualReturn / 12;
  const monthlyStdDev = returnStdDev / Math.sqrt(12);
  const monthlyBondReturn = bondReturnRate / 12;
  const monthlyBondStdDev = bondVolatility / Math.sqrt(12);

  // Helper functions
  
  /**
   * Generate random return using Box-Muller transformation
   */
  function generateRandomReturn() {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return monthlyReturn + (monthlyStdDev * z);
  }

  /**
   * Generate random annual return
   */
  function generateAnnualReturn() {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return annualReturn + (returnStdDev * z);
  }

  /**
   * Generate random annual bond return
   */
  function generateAnnualBondReturn() {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return bondReturnRate + (bondVolatility * z);
  }

  /**
   * Calculate state pension based on age
   */
  function calculateStatePension(age) {
    return age >= UK_STATE_PENSION_AGE ? UK_STATE_PENSION_MONTHLY_2024 : 0;
  }

  /**
   * Calculate stock allocation based on bond tent glide path
   */
  function getStockAllocation(yearsIntoRetirement) {
    if (!useBondTent) {
      return 1.0; // 100% stocks if no bond tent
    }
    
    if (yearsIntoRetirement <= 0) {
      return stockAllocRetirement;
    } else if (yearsIntoRetirement >= glidePeriodYears) {
      return stockAllocLater;
    } else {
      // Linear interpolation during glide period
      const progress = yearsIntoRetirement / glidePeriodYears;
      return stockAllocRetirement + (stockAllocLater - stockAllocRetirement) * progress;
    }
  }

  /**
   * Get annual portfolio return based on bond tent allocation
   */
  function getAnnualPortfolioReturn(yearsIntoRetirement) {
    const stockAlloc = getStockAllocation(yearsIntoRetirement);
    const bondAlloc = 1 - stockAlloc;
    
    const stockReturn = generateAnnualReturn();
    const bondReturn = useBondTent ? generateAnnualBondReturn() : 0;
    
    return (stockReturn * stockAlloc) + (bondReturn * bondAlloc);
  }

  /**
   * Calculate withdrawal amount based on strategy
   */
  function getStrategyWithdrawalAmount(baseAmount, portfolioValue, initialValue, yearsElapsed, strategy) {
    let expectedAnnualReturn = annualReturn;
    if (useBondTent) {
      const stockAlloc = getStockAllocation(yearsElapsed);
      const bondAlloc = 1 - stockAlloc;
      expectedAnnualReturn = (annualReturn * stockAlloc) + (bondReturnRate * bondAlloc);
    }
    
    const expectedValue = initialValue * Math.pow(1 + expectedAnnualReturn, yearsElapsed);
    const performanceRatio = expectedValue > 0 ? portfolioValue / expectedValue : 1;

    switch (strategy) {
      case 1: // Fixed withdrawal
        return baseAmount;
      
      case 2: // Guardrails strategy
        if (performanceRatio < 0.8) {
          return baseAmount * 0.9; // 10% reduction
        } else if (performanceRatio > 1.2) {
          return baseAmount * 1.1; // 10% increase
        }
        return baseAmount;
      
      case 3: // Cash buffer strategy - handled separately
        return baseAmount;
      
      case 4: // Essential/discretionary split
        if (performanceRatio < 0.9) {
          return baseAmount * essentialExpenseRatio; // Only essential expenses
        }
        return baseAmount;
      
      default:
        return baseAmount;
    }
  }

  /**
   * Calculate cash buffer amount for strategy 3
   */
  function calculateCashBufferAmount(recentReturns, bearMarketMonths, targetAmount) {
    if (recentReturns.length === 0) return 0;
    
    const avgReturn = recentReturns.reduce((sum, ret) => sum + ret, 0) / recentReturns.length;
    
    let bufferMultiplier = 0;
    
    if (avgReturn < -0.1) { // Average annual return below -10%
      bufferMultiplier = 0.5; // 50% buffer
    } else if (avgReturn < 0) { // Negative but above -10%
      bufferMultiplier = 0.25; // 25% buffer
    } else if (bearMarketMonths > 24) { // Extended bear market (2+ years)
      bufferMultiplier = 0.3; // 30% buffer
    } else if (bearMarketMonths > 12) { // Bear market (1+ year)
      bufferMultiplier = 0.15; // 15% buffer
    }
    
    return targetAmount * bufferMultiplier;
  }

  /**
   * Calculate optimal annual withdrawal from accounts
   * Bug fix: Now uses single tax calculation function
   */
  function calculateOptimalAnnualWithdrawal(pensionBal, taxFreeBal, targetIncome, currentAge, taxFreeUsed = 0, yearsRemaining = 0, useOptimization = true, inflationRate = 0.025, useBondTent = false, annualReturn = 0.07, bondReturnRate = 0.03, stockAllocRetirement = 0.6, stockAllocLater = 0.4, glidePeriodYears = 10) {
    const statePension = calculateStatePension(currentAge) * 12; // Annual state pension
    let adjustedTarget = Math.max(0, targetIncome - statePension);
    
    if (adjustedTarget <= 0) {
      return {
        pensionWithdrawal: 0,
        taxFreeWithdrawal: 0,
        totalTax: 0,
        netIncome: statePension,
        newTaxFreeUsed: taxFreeUsed
      };
    }

    // Before age 58: tax-free only
    if (currentAge < UK_PENSION_ACCESS_AGE) {
      const withdrawal = Math.min(adjustedTarget, taxFreeBal);
      return {
        pensionWithdrawal: 0,
        taxFreeWithdrawal: withdrawal,
        totalTax: 0,
        netIncome: withdrawal + statePension,
        newTaxFreeUsed: taxFreeUsed
      };
    }

    // Age 58+: Use optimization if enabled and conditions are met
    if (useOptimization && yearsRemaining > 5 && (pensionBal > 0 && taxFreeBal > 0)) {
      return findOptimalWithdrawalRatio(pensionBal, taxFreeBal, targetIncome, currentAge, taxFreeUsed, yearsRemaining, inflationRate, useBondTent, annualReturn, bondReturnRate, stockAllocRetirement, stockAllocLater, glidePeriodYears);
    }

    // Fallback to original pension-first strategy with 25% tax-free benefit
    const remainingTaxFreeAllowance = Math.max(0, UK_PENSION_TAX_FREE_LIFETIME_LIMIT - taxFreeUsed);
    
    // Binary search for optimal pension withdrawal
    let low = 0;
    let high = Math.min(pensionBal, adjustedTarget * 1.5);
    
    for (let i = 0; i < 15; i++) {
      const pensionWithdrawal = (low + high) / 2;
      
      // Calculate 25% tax-free portion
      const potentialTaxFree = pensionWithdrawal * UK_PENSION_TAX_FREE_PERCENT;
      const actualTaxFree = Math.min(potentialTaxFree, remainingTaxFreeAllowance);
      const taxablePension = pensionWithdrawal - actualTaxFree;
      
      // Calculate annual tax (bug fix: use single tax function)
      const totalTaxableIncome = taxablePension + statePension;
      const totalTax = calculateUKIncomeTax(totalTaxableIncome);
      const stateTax = calculateUKIncomeTax(statePension);
      const pensionTax = Math.max(0, totalTax - stateTax);
      
      // Net from pension = tax-free portion + (taxable portion - tax)
      const netFromPension = actualTaxFree + Math.max(0, taxablePension - pensionTax);
      
      if (Math.abs(netFromPension - adjustedTarget) < 1) break;
      
      if (netFromPension < adjustedTarget) {
        low = pensionWithdrawal;
      } else {
        high = pensionWithdrawal;
      }
    }
    
    const pensionWithdrawal = Math.min(pensionBal, (low + high) / 2);
    
    // Final calculation
    const potentialTaxFree = pensionWithdrawal * UK_PENSION_TAX_FREE_PERCENT;
    const actualTaxFree = Math.min(potentialTaxFree, remainingTaxFreeAllowance);
    const taxablePension = pensionWithdrawal - actualTaxFree;
    
    const totalTaxableIncome = taxablePension + statePension;
    const totalTax = calculateUKIncomeTax(totalTaxableIncome);
    const stateTax = calculateUKIncomeTax(statePension);
    const pensionTax = Math.max(0, totalTax - stateTax);
    
    const netFromPension = actualTaxFree + Math.max(0, taxablePension - pensionTax);
    
    // Use ISA for shortfall
    const shortfall = Math.max(0, adjustedTarget - netFromPension);
    const taxFreeWithdrawal = Math.min(shortfall, taxFreeBal);
    
    return {
      pensionWithdrawal,
      taxFreeWithdrawal,
      totalTax: pensionTax,
      netIncome: netFromPension + taxFreeWithdrawal + statePension,
      newTaxFreeUsed: taxFreeUsed + actualTaxFree
    };
  }

  /**
   * Calculate withdrawal using a specific pension ratio
   * Bug fix: Input validation added
   */
  function calculateWithdrawalWithRatio(pensionBal, taxFreeBal, targetIncome, currentAge, taxFreeUsed, pensionRatio) {
    // Input validation
    if (pensionBal < 0 || taxFreeBal < 0) return { pensionWithdrawal: 0, taxFreeWithdrawal: 0, totalTax: 0, netIncome: 0, newTaxFreeUsed: taxFreeUsed };
    if (targetIncome < 0) return { pensionWithdrawal: 0, taxFreeWithdrawal: 0, totalTax: 0, netIncome: 0, newTaxFreeUsed: taxFreeUsed };
    if (pensionRatio < 0) pensionRatio = 0;
    if (pensionRatio > 1) pensionRatio = 1;
    
    // Calculate state pension based on age
    const statePension = currentAge >= UK_STATE_PENSION_AGE ? UK_STATE_PENSION_MONTHLY_2024 * 12 : 0;
    let adjustedTarget = Math.max(0, targetIncome - statePension);
    
    if (adjustedTarget <= 0 || (pensionBal + taxFreeBal) <= 0) {
      return {
        pensionWithdrawal: 0,
        taxFreeWithdrawal: 0,
        totalTax: 0,
        netIncome: statePension,
        newTaxFreeUsed: taxFreeUsed
      };
    }

    // Before age 58: tax-free only
    if (currentAge < UK_PENSION_ACCESS_AGE) {
      const withdrawal = Math.min(adjustedTarget, taxFreeBal);
      return {
        pensionWithdrawal: 0,
        taxFreeWithdrawal: withdrawal,
        totalTax: 0,
        netIncome: withdrawal + statePension,
        newTaxFreeUsed: taxFreeUsed
      };
    }

    // Calculate target withdrawals based on ratio
    let targetPensionWithdrawal = 0;
    let targetTaxFreeWithdrawal = 0;
    
    if (pensionRatio > 0 && pensionBal > 0) {
      // Simple approach: target a portion of the adjusted target from pension
      // This will be refined through the tax calculation below
      const maxPensionPortion = adjustedTarget * (pensionRatio / (pensionRatio + (1 - pensionRatio)));
      targetPensionWithdrawal = Math.min(pensionBal, maxPensionPortion * 1.5); // Allow for tax grossing up
    }

    // Calculate actual withdrawal amounts with tax considerations
    const remainingTaxFreeAllowance = Math.max(0, UK_PENSION_TAX_FREE_LIFETIME_LIMIT - taxFreeUsed);
    const potentialTaxFree = targetPensionWithdrawal * UK_PENSION_TAX_FREE_PERCENT;
    const actualTaxFree = Math.min(potentialTaxFree, remainingTaxFreeAllowance);
    const taxablePension = targetPensionWithdrawal - actualTaxFree;
    
    // Calculate tax on pension withdrawal (bug fix: use single tax function)
    const totalTaxableIncome = taxablePension + statePension;
    const totalTax = calculateUKIncomeTax(totalTaxableIncome);
    const stateTax = calculateUKIncomeTax(statePension);
    const pensionTax = Math.max(0, totalTax - stateTax);
    
    const netFromPension = actualTaxFree + Math.max(0, taxablePension - pensionTax);
    const shortfall = Math.max(0, adjustedTarget - netFromPension);
    targetTaxFreeWithdrawal = Math.min(shortfall, taxFreeBal);

    return {
      pensionWithdrawal: targetPensionWithdrawal,
      taxFreeWithdrawal: targetTaxFreeWithdrawal,
      totalTax: pensionTax,
      netIncome: netFromPension + targetTaxFreeWithdrawal + statePension,
      newTaxFreeUsed: taxFreeUsed + actualTaxFree
    };
  }

  /**
   * Simulate portfolio survival with a specific pension withdrawal ratio
   * Bug fix: Use global WITHDRAWAL_TOLERANCE constant
   * Simplified: Just return years survived, no artificial bonuses
   */
  function simulateWithdrawalRatio(pensionBal, taxFreeBal, targetIncome, startAge, taxFreeUsed, pensionRatio, yearsRemaining, inflationRate, useBondTent, annualReturn, bondReturnRate, stockAllocRetirement, stockAllocLater, glidePeriodYears) {
    let tempPensionBal = pensionBal;
    let tempTaxFreeBal = taxFreeBal;
    let tempTaxFreeUsed = taxFreeUsed;
    
    const simYears = Math.min(yearsRemaining, 25); // 25 years lookahead as requested

    for (let year = 0; year < simYears; year++) {
      const currentAge = startAge + year;
      const inflationAdjustedTarget = targetIncome * Math.pow(1 + inflationRate, year);
      
      // Apply expected returns (use conservative estimate for optimization)
      const stockAlloc = getStockAllocation(year);
      const conservativeReturn = useBondTent ? 
        (annualReturn * stockAlloc + bondReturnRate * (1 - stockAlloc)) * 0.8 : 
        annualReturn * 0.8; // 80% of expected return for conservative estimate
      
      tempPensionBal *= (1 + conservativeReturn);
      tempTaxFreeBal *= (1 + conservativeReturn);

      // Calculate withdrawal using the specified ratio
      const withdrawal = calculateWithdrawalWithRatio(
        tempPensionBal,
        tempTaxFreeBal,
        inflationAdjustedTarget,
        currentAge,
        tempTaxFreeUsed,
        pensionRatio
      );

      // Check if target is met (bug fix: use global constant)
      if (withdrawal.netIncome < inflationAdjustedTarget * (1 - WITHDRAWAL_TOLERANCE)) {
        return year; // Failed at this year
      }

      // Update balances
      tempPensionBal = Math.max(0, tempPensionBal - withdrawal.pensionWithdrawal);
      tempTaxFreeBal = Math.max(0, tempTaxFreeBal - withdrawal.taxFreeWithdrawal);
      tempTaxFreeUsed = withdrawal.newTaxFreeUsed;
    }

    return simYears; // Survived all years tested
  }

  /**
   * Find optimal withdrawal ratio - keep the original nested approach
   * Simplified: Just find ratio that survives longest
   */
  function findOptimalWithdrawalRatio(pensionBal, taxFreeBal, targetIncome, currentAge, taxFreeUsed, yearsRemaining, inflationRate, useBondTent, annualReturn, bondReturnRate, stockAllocRetirement, stockAllocLater, glidePeriodYears) {
    if (yearsRemaining <= 0 || (pensionBal + taxFreeBal) <= 0) {
      return calculateOptimalAnnualWithdrawal(pensionBal, taxFreeBal, targetIncome, currentAge, taxFreeUsed, 0, false, inflationRate, useBondTent, annualReturn, bondReturnRate, stockAllocRetirement, stockAllocLater, glidePeriodYears);
    }

    let bestRatio = 0;
    let bestYearsSurvived = -1;

    // Test pension ratios from 0% to 100% in 10% increments
    for (let pensionRatio = 0; pensionRatio <= 1.0; pensionRatio += 0.1) {
      const yearsSurvived = simulateWithdrawalRatio(
        pensionBal, 
        taxFreeBal, 
        targetIncome, 
        currentAge, 
        taxFreeUsed, 
        pensionRatio, 
        yearsRemaining,
        inflationRate,
        useBondTent,
        annualReturn,
        bondReturnRate,
        stockAllocRetirement,
        stockAllocLater,
        glidePeriodYears
      );
      
      if (yearsSurvived > bestYearsSurvived) {
        bestYearsSurvived = yearsSurvived;
        bestRatio = pensionRatio;
      }
    }

    // Fine-tune around the best ratio found
    const refinedRatio = refineOptimalRatio(
      pensionBal, 
      taxFreeBal, 
      targetIncome, 
      currentAge, 
      taxFreeUsed, 
      bestRatio, 
      yearsRemaining,
      inflationRate,
      useBondTent,
      annualReturn,
      bondReturnRate,
      stockAllocRetirement,
      stockAllocLater,
      glidePeriodYears
    );

    return calculateWithdrawalWithRatio(
      pensionBal, 
      taxFreeBal, 
      targetIncome, 
      currentAge, 
      taxFreeUsed, 
      refinedRatio
    );
  }

  /**
   * Fine-tune the optimal ratio around the best found ratio
   * Simplified: Just find ratio that survives longest
   */
  function refineOptimalRatio(pensionBal, taxFreeBal, targetIncome, currentAge, taxFreeUsed, bestRatio, yearsRemaining, inflationRate, useBondTent, annualReturn, bondReturnRate, stockAllocRetirement, stockAllocLater, glidePeriodYears) {
    let optimalRatio = bestRatio;
    let bestYearsSurvived = simulateWithdrawalRatio(pensionBal, taxFreeBal, targetIncome, currentAge, taxFreeUsed, bestRatio, yearsRemaining, inflationRate, useBondTent, annualReturn, bondReturnRate, stockAllocRetirement, stockAllocLater, glidePeriodYears);

    // Test ratios around the best in 2% increments
    for (let offset = -0.08; offset <= 0.08; offset += 0.02) {
      const testRatio = Math.max(0, Math.min(1, bestRatio + offset));
      const yearsSurvived = simulateWithdrawalRatio(pensionBal, taxFreeBal, targetIncome, currentAge, taxFreeUsed, testRatio, yearsRemaining, inflationRate, useBondTent, annualReturn, bondReturnRate, stockAllocRetirement, stockAllocLater, glidePeriodYears);
      
      if (yearsSurvived > bestYearsSurvived) {
        bestYearsSurvived = yearsSurvived;
        optimalRatio = testRatio;
      }
    }

    return optimalRatio;
  }

  // Main binary search logic with 30-second optimizations
  let low = 0;
  let high = maxSavingMonths;
  let bestSolution = null;
  
  while (high - low > 1) {
    // Time check - conservative 27 second limit
    if (Date.now() - startTime > 27000) {
      console.warn("Approaching 30s limit, returning best result");
      return bestSolution || [-1, 0, 0];
    }
    
    const savingMonths = Math.floor((low + high) / 2);
    const retirementStartAge = currentAge + (savingMonths / 12);
    
    if (retirementStartAge >= 95) {
      high = savingMonths;
      continue;
    }
    
    // Calculate EXPECTED portfolio values at retirement for return values
    let expectedPensionAtRetirement = pensionBalance;
    let expectedTaxFreeAtRetirement = taxFreeBalance;
    const monthlyGrowthFactor = Math.pow(1 + annualReturn, 1/12);
    
    for (let month = 0; month < savingMonths; month++) {
      expectedPensionAtRetirement = expectedPensionAtRetirement * monthlyGrowthFactor + monthlyPensionSavings;
      expectedTaxFreeAtRetirement = expectedTaxFreeAtRetirement * monthlyGrowthFactor + monthlyTaxFreeSavings;
    }
    
    const expectedTotalValue = expectedPensionAtRetirement + expectedTaxFreeAtRetirement;
    
    // Quick check using expected values for 4% rule
    const expectedWithdrawalRate = (monthlyWithdrawalNeeded * 12) / expectedTotalValue;
    if (expectedWithdrawalRate > 0.04) {
      console.log(`Instant fail: ${(expectedWithdrawalRate * 100).toFixed(1)}% expected withdrawal rate at ${(savingMonths/12).toFixed(1)} years`);
      low = savingMonths;
      continue;
    }
    
    // Get adaptive simulation count based on withdrawal rate at retirement
    let adaptiveSimulations = getAdaptiveSimulations(
      expectedPensionAtRetirement, expectedTaxFreeAtRetirement, monthlyWithdrawalNeeded, simulations, savingMonths / 12
    );
    
    // For very short accumulation periods, force more simulations to reduce variance
    // This helps prevent non-monotonic results like £4k > £5k
    if (savingMonths < 36 && expectedWithdrawalRate > 0.03) { // < 3 years and borderline
      adaptiveSimulations = Math.max(adaptiveSimulations, Math.min(1200, simulations * 1.2));
      console.log(`Borderline case (${(savingMonths/12).toFixed(1)}y, ${(expectedWithdrawalRate*100).toFixed(1)}%), using ${adaptiveSimulations} simulations`);
    }
    
    // Run Monte Carlo simulation for retirement phase
    let successfulSimulations = 0;
    let failedSimulations = 0;
    
    for (let sim = 0; sim < adaptiveSimulations; sim++) {
      // Early exit check every 100 simulations
      if (sim > 0 && sim % 100 === 0) {
        if (shouldExitEarly(successfulSimulations, failedSimulations, adaptiveSimulations, targetSuccessRate)) {
          console.log(`Early exit at ${sim} simulations`);
          break;
        }
      }
      
      // Each simulation gets its own accumulation phase with random returns
      let pensionAtRetirement = pensionBalance;
      let taxFreeAtRetirement = taxFreeBalance;
      
      // Accumulation phase with random returns
      for (let month = 0; month < savingMonths; month++) {
        const currentReturn = generateRandomReturn();
        pensionAtRetirement = pensionAtRetirement * (1 + currentReturn) + monthlyPensionSavings;
        taxFreeAtRetirement = taxFreeAtRetirement * (1 + currentReturn) + monthlyTaxFreeSavings;
      }
      
      let pensionBal = pensionAtRetirement;
      let taxFreeBal = taxFreeAtRetirement;
      let simulationSuccess = true;
      let pensionTaxFreeUsed = 0;

      let recentReturns = [];
      let bearMarketMonths = 0;

      // Withdrawal phase simulation (annual withdrawals)
      const withdrawalYears = 95 - retirementStartAge;
      const initialTotalValue = pensionBal + taxFreeBal;
      
      for (let year = 0; year < withdrawalYears && simulationSuccess; year++) {
        const yearsIntoRetirement = year;
        const currentRetirementAge = retirementStartAge + yearsIntoRetirement;
        
        // Apply annual returns
        const currentReturn = useBondTent ? 
          getAnnualPortfolioReturn(yearsIntoRetirement) : 
          generateAnnualReturn();
        
        pensionBal = pensionBal * (1 + currentReturn);
        taxFreeBal = taxFreeBal * (1 + currentReturn);
        
        // Calculate inflation-adjusted annual withdrawal target
        const annualInflationAdjustedWithdrawal = monthlyWithdrawalNeeded * 12 * Math.pow(1 + inflationRate, yearsIntoRetirement);
        
        // Get strategy-adjusted target amount
        const targetAmount = getStrategyWithdrawalAmount(
          annualInflationAdjustedWithdrawal, 
          pensionBal + taxFreeBal, 
          initialTotalValue, 
          year, 
          withdrawalStrategy
        );
        
        // Calculate buffer for cash buffer strategy
        let bufferAmount = 0;
        if (withdrawalStrategy === 3) {
          bufferAmount = calculateCashBufferAmount(recentReturns, bearMarketMonths, targetAmount);
        }
        
        // Calculate optimal annual withdrawal with years remaining for optimization
        const withdrawal = calculateOptimalAnnualWithdrawal(
          pensionBal,
          taxFreeBal,
          targetAmount,
          currentRetirementAge,
          pensionTaxFreeUsed,
          withdrawalYears - year, // Years remaining
          true, // Use optimization
          inflationRate,
          useBondTent,
          annualReturn,
          bondReturnRate,
          stockAllocRetirement,
          stockAllocLater,
          glidePeriodYears
        );
        
        const totalNetIncome = withdrawal.netIncome + bufferAmount;
        if (totalNetIncome < targetAmount * (1 - WITHDRAWAL_TOLERANCE)) {
          simulationSuccess = false;
          break;
        }
        
        pensionBal = Math.max(0, pensionBal - withdrawal.pensionWithdrawal);
        taxFreeBal = Math.max(0, taxFreeBal - withdrawal.taxFreeWithdrawal);
        pensionTaxFreeUsed = withdrawal.newTaxFreeUsed;
        
        // Update bear market tracking (simplified for annual)
        if (currentReturn < -0.1) { // 10% annual loss
          bearMarketMonths = Math.min(bearMarketMonths + 12, 36);
        } else {
          bearMarketMonths = Math.max(bearMarketMonths - 6, 0);
        }
        
        // Update recent returns (track last 3 years)
        recentReturns.push(currentReturn);
        if (recentReturns.length > 3) {
          recentReturns.shift();
        }
      }

      if (simulationSuccess) {
        successfulSimulations++;
      } else {
        failedSimulations++;
      }
    }
    
    const actualSimulations = successfulSimulations + failedSimulations;
    const successRate = successfulSimulations / actualSimulations;
    
    // Standard binary search - no skipping for accuracy
    if (successRate >= targetSuccessRate) {
      // Return EXPECTED values, not random accumulation values
      bestSolution = [savingMonths / 12, expectedPensionAtRetirement, expectedTaxFreeAtRetirement];
      high = savingMonths;
    } else {
      low = savingMonths;
    }
  }
  
  const totalTime = Date.now() - startTime;
  console.log(`Completed in ${totalTime}ms`);
  
  return bestSolution || [-1, 0, 0];
}

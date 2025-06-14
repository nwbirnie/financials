/**
 * Calculates months of saving needed to sustain withdrawal rate until age 95
 * Uses Monte Carlo simulation with separate pension and tax-free accounts
 * 
 * @customfunction
 * @param {number} pensionBalance - Initial pension balance (taxed on withdrawal)
 * @param {number} taxFreeBalance - Initial tax-free balance (ISA, etc.)
 * @param {number} monthlyPensionSavings - Monthly pension contributions
 * @param {number} monthlyTaxFreeSavings - Monthly tax-free savings
 * @param {number} annualReturn - Expected annual rate of return for stocks (as decimal, e.g., 0.07 for 7%)
 * @param {number} returnStdDev - Standard deviation of annual returns (as decimal)
 * @param {number} monthlyWithdrawalNeeded - Monthly net income needed (after tax)
 * @param {number} currentAge - Current age
 * @param {number} targetSuccessRate - Target success rate (as decimal, e.g., 0.9 for 90%)
 * @param {number} inflationRate - Annual inflation rate (as decimal, e.g., 0.025 for 2.5%)
 * @param {number} withdrawalStrategy - Strategy: 1=Fixed, 2=Guardrails, 3=Cash Buffer, 4=Essential/Discretionary
 * @param {number} essentialExpenseRatio - For strategy 4: ratio of essential to total expenses (default: 0.7)
 * @param {number} maxSavingMonths - Maximum months to test (default: 600 = 50 years)
 * @param {number} simulations - Number of Monte Carlo simulations (default: 1000)
 * @param {boolean} useBondTent - Enable bond tent/glide path (default: false)
 * @param {number} bondReturnRate - Annual return for bonds (default: 0.03 for 3%)
 * @param {number} bondVolatility - Bond volatility (default: 0.05 for 5%)
 * @param {number} stockAllocRetirement - Stock allocation % at retirement start (default: 0.6 for 60%)
 * @param {number} stockAllocLater - Stock allocation % in later retirement (default: 0.4 for 40%)
 * @param {number} glidePeriodYears - Years to transition from retirement to later allocation (default: 10)
 * @returns {number[]} Array: [years_needed, pension_balance_at_retirement, tax_free_balance_at_retirement]
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
  bondReturnRate = 0.05,
  bondVolatility = 0.08,
  stockAllocRetirement = 0.8,
  stockAllocLater = 0.8,
  maxSavingMonths = 600,
  simulations = 1000,
  glidePeriodYears = 10
) {
  try {
    // Input validation
    if (currentAge >= 95 || currentAge < 18) {
      throw new Error("Current age must be between 18 and 95");
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
    if (inflationRate < 0 || inflationRate > 0.2) {
      throw new Error("Inflation rate must be between 0% and 20%");
    }
    if (essentialExpenseRatio < 0 || essentialExpenseRatio > 1) {
      throw new Error("Essential expense ratio must be between 0 and 1");
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

    // Constants
    const UK_PENSION_ACCESS_AGE = 58;
    const UK_STATE_PENSION_AGE = 68;
    const UK_STATE_PENSION_MONTHLY_2024 = 915.40;
    const WITHDRAWAL_TOLERANCE = 0.02;
    
    const monthsToAge95 = (95 - currentAge) * 12;
    const monthlyReturn = annualReturn / 12;
    const monthlyStdDev = returnStdDev / Math.sqrt(12);
    
    // Bond tent parameters
    const monthlyBondReturn = bondReturnRate / 12;
    const monthlyBondStdDev = bondVolatility / Math.sqrt(12);

    // Strategy constants
    const GUARDRAILS_THRESHOLD = 0.8;
    const GUARDRAILS_ADJUSTMENT = 0.9;
    const BUFFER_MONTHS = 18;
    const BUFFER_MAX_PERCENT = 0.15;
    const BUFFER_ANNUAL_RETURN = 0.02;
    const QUARTERLY_REPLENISH_THRESHOLD = 0.045;
    const ESSENTIAL_FLOOR = 0.8;
    const DISCRETIONARY_CEILING = 1.2;

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
     * Generate random bond return using Box-Muller transformation
     */
    function generateRandomBondReturn() {
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return monthlyBondReturn + (monthlyBondStdDev * z);
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
     * Generate blended portfolio return based on stock/bond allocation
     */
    function generatePortfolioReturn(yearsIntoRetirement) {
      const stockAlloc = getStockAllocation(yearsIntoRetirement);
      const bondAlloc = 1 - stockAlloc;
      
      const stockReturn = generateRandomReturn();
      const bondReturn = useBondTent ? generateRandomBondReturn() : 0;
      
      return (stockReturn * stockAlloc) + (bondReturn * bondAlloc);
    }

    /**
     * Calculate UK income tax on annual income
     */
    function calculateUKIncomeTax(grossAnnualIncome) {
      const personalAllowance = 12570;
      const basicRateLimit = 50270;
      const higherRateLimit = 125140;
      const basicRate = 0.20;
      const higherRate = 0.40;
      const additionalRate = 0.45;
      
      if (grossAnnualIncome <= personalAllowance) return 0;
      
      let tax = 0;
      let taxableIncome = grossAnnualIncome - personalAllowance;
      
      // Basic rate
      if (taxableIncome > 0) {
        const basicRateTaxable = Math.min(taxableIncome, basicRateLimit - personalAllowance);
        tax += basicRateTaxable * basicRate;
        taxableIncome -= basicRateTaxable;
      }
      
      // Higher rate
      if (taxableIncome > 0) {
        const higherRateTaxable = Math.min(taxableIncome, higherRateLimit - basicRateLimit);
        tax += higherRateTaxable * higherRate;
        taxableIncome -= higherRateTaxable;
      }
      
      // Additional rate
      if (taxableIncome > 0) {
        tax += taxableIncome * additionalRate;
      }
      
      return tax;
    }

    /**
     * Calculate state pension (fixed rate)
     */
    function calculateStatePension(currentAge) {
      if (currentAge < UK_STATE_PENSION_AGE) return 0;
      return UK_STATE_PENSION_MONTHLY_2024;
    }

    /**
     * Calculate inflation-adjusted withdrawal amount
     */
    function getInflationAdjustedAmount(baseAmount, yearsElapsed) {
      return baseAmount * Math.pow(1 + inflationRate, yearsElapsed);
    }

    /**
     * Calculate withdrawal amount based on strategy
     */
    function getStrategyWithdrawalAmount(baseAmount, portfolioValue, initialValue, monthsElapsed, strategy) {
      // For bond tent, use blended expected return for performance calculation
      let expectedMonthlyReturn = monthlyReturn; // Default to stock return
      if (useBondTent) {
        const yearsElapsed = monthsElapsed / 12;
        const stockAlloc = getStockAllocation(yearsElapsed);
        const bondAlloc = 1 - stockAlloc;
        expectedMonthlyReturn = (monthlyReturn * stockAlloc) + (monthlyBondReturn * bondAlloc);
      }
      
      const expectedValue = initialValue * Math.pow(1 + expectedMonthlyReturn, monthsElapsed);
      const performanceRatio = expectedValue > 0 ? portfolioValue / expectedValue : 1;
      
      switch (strategy) {
        case 1: // Fixed
          return baseAmount;
          
        case 2: // Guardrails
        case 3: // Cash Buffer (uses guardrails when not using buffer)
          if (performanceRatio < GUARDRAILS_THRESHOLD) {
            return baseAmount * GUARDRAILS_ADJUSTMENT;
          } else {
            return baseAmount;
          }
          
        case 4: // Essential/Discretionary
          const essentialAmount = baseAmount * essentialExpenseRatio;
          const discretionaryAmount = baseAmount * (1 - essentialExpenseRatio);
          
          if (performanceRatio < ESSENTIAL_FLOOR) {
            const reduction = Math.min(0.5, (ESSENTIAL_FLOOR - performanceRatio) / 0.2 * 0.5);
            return essentialAmount + (discretionaryAmount * (1 - reduction));
          } else if (performanceRatio > DISCRETIONARY_CEILING) {
            const increase = Math.min(0.3, (performanceRatio - DISCRETIONARY_CEILING) / 0.3 * 0.3);
            return essentialAmount + (discretionaryAmount * (1 + increase));
          } else {
            return baseAmount;
          }
          
        default:
          return baseAmount;
      }
    }

    /**
     * Calculate optimal withdrawal from accounts
     */
    function calculateOptimalWithdrawal(pensionBal, taxFreeBal, targetIncome, currentAge) {
      const statePension = calculateStatePension(currentAge);
      const adjustedTarget = Math.max(0, targetIncome - statePension);
      
      if (adjustedTarget <= 0) {
        return {
          pensionWithdrawal: 0,
          taxFreeWithdrawal: 0,
          totalTax: 0,
          netIncome: statePension
        };
      }

      // Before age 58: tax-free only
      if (currentAge < UK_PENSION_ACCESS_AGE) {
        const withdrawal = Math.min(adjustedTarget, taxFreeBal);
        return {
          pensionWithdrawal: 0,
          taxFreeWithdrawal: withdrawal,
          totalTax: 0,
          netIncome: withdrawal + statePension
        };
      }

      // Age 58+: pension first for tax efficiency
      let low = adjustedTarget;
      let high = Math.min(pensionBal, adjustedTarget * 2);
      
      // Binary search for optimal pension withdrawal
      for (let i = 0; i < 20; i++) {
        const mid = (low + high) / 2;
        const combinedGross = mid + statePension;
        const totalTax = calculateUKIncomeTax(combinedGross * 12) / 12;
        const stateTax = calculateUKIncomeTax(statePension * 12) / 12;
        const pensionTax = totalTax - stateTax;
        const netFromPension = mid - pensionTax;
        
        if (Math.abs(netFromPension - adjustedTarget) < 0.01) break;
        
        if (netFromPension < adjustedTarget) {
          low = mid;
        } else {
          high = mid;
        }
      }
      
      const pensionWithdrawal = Math.min(pensionBal, (low + high) / 2);
      const combinedGross = pensionWithdrawal + statePension;
      const totalTax = calculateUKIncomeTax(combinedGross * 12) / 12;
      const stateTax = calculateUKIncomeTax(statePension * 12) / 12;
      const pensionTax = totalTax - stateTax;
      const netFromPension = pensionWithdrawal - pensionTax;
      
      // Use tax-free for shortfall
      const shortfall = Math.max(0, adjustedTarget - netFromPension);
      const taxFreeWithdrawal = Math.min(shortfall, taxFreeBal);
      
      return {
        pensionWithdrawal,
        taxFreeWithdrawal,
        totalTax: pensionTax,
        netIncome: netFromPension + taxFreeWithdrawal + statePension
      };
    }

    /**
     * Run Monte Carlo simulation
     */
    function simulateRetirement(savingMonths) {
      let successfulSimulations = 0;
      let totalPensionAtRetirement = 0;
      let totalTaxFreeAtRetirement = 0;
      
      for (let sim = 0; sim < simulations; sim++) {
        let pensionBal = pensionBalance;
        let taxFreeBal = taxFreeBalance;
        let cashBuffer = 0;
        let initialBufferTarget = 0;
        let recentReturns = []; // Track recent returns for 3-month calculation
        let bearMarketMonths = 0; // Track prolonged downturns
        
        // Accumulation phase - always 100% stocks
        for (let month = 0; month < savingMonths; month++) {
          const currentReturn = generateRandomReturn(); // Full stock returns during accumulation
          pensionBal = pensionBal * (1 + currentReturn) + monthlyPensionSavings;
          taxFreeBal = taxFreeBal * (1 + currentReturn) + monthlyTaxFreeSavings;
        }
        
        const retirementPensionBalance = pensionBal;
        const retirementTaxFreeBalance = taxFreeBal;
        const initialTotalBalance = pensionBal + taxFreeBal;
        
        // Initialize cash buffer for strategy 3
        if (withdrawalStrategy === 3) {
          const bufferAmount = monthlyWithdrawalNeeded * BUFFER_MONTHS;
          const maxBufferFromTaxFree = taxFreeBal * BUFFER_MAX_PERCENT;
          cashBuffer = Math.min(bufferAmount, maxBufferFromTaxFree);
          taxFreeBal = Math.max(0, taxFreeBal - cashBuffer);
          initialBufferTarget = cashBuffer;
        }
        
        // Withdrawal phase
        const withdrawalMonths = monthsToAge95 - savingMonths;
        const retirementStartAge = currentAge + (savingMonths / 12);
        let simulationSuccess = true;
        
        for (let month = 0; month < withdrawalMonths && simulationSuccess; month++) {
          const yearsIntoRetirement = month / 12;
          const currentReturn = generatePortfolioReturn(yearsIntoRetirement); // Use blended return
          const currentRetirementAge = retirementStartAge + yearsIntoRetirement;
          
          // Track recent returns for 3-month performance calculation
          recentReturns.push(currentReturn);
          if (recentReturns.length > 3) {
            recentReturns.shift(); // Keep only last 3 months
          }
          
          // Track bear market duration for adaptive buffer replenishment
          if (currentReturn < -0.01) { // Month with >1% decline
            bearMarketMonths++;
          } else if (currentReturn > 0.01) { // Month with >1% gain
            bearMarketMonths = Math.max(0, bearMarketMonths - 1); // Slowly reduce bear market counter
          }
          
          // Calculate inflation-adjusted withdrawal need
          const inflationAdjustedWithdrawal = getInflationAdjustedAmount(monthlyWithdrawalNeeded, yearsIntoRetirement);
          
          // Apply returns
          pensionBal = Math.max(0, pensionBal * (1 + currentReturn));
          taxFreeBal = Math.max(0, taxFreeBal * (1 + currentReturn));
          
          // Cash buffer earns 2% annually
          if (cashBuffer > 0) {
            cashBuffer = cashBuffer * (1 + (BUFFER_ANNUAL_RETURN / 12));
          }
          
          // Critical rule: tax-free must last until pension access
          if (currentRetirementAge < UK_PENSION_ACCESS_AGE && taxFreeBal <= 0 && cashBuffer <= 0) {
            simulationSuccess = false;
            break;
          }
          
          // Determine withdrawal approach
          let useBuffer = false;
          let bufferAmount = 0;
          let targetAmount = inflationAdjustedWithdrawal;
          
          if (withdrawalStrategy === 3) {
            // Use cash buffer during any negative return month if available
            if (currentReturn < 0 && cashBuffer > 0) {
              // Use partial or full buffer
              bufferAmount = Math.min(cashBuffer, inflationAdjustedWithdrawal);
              if (bufferAmount >= inflationAdjustedWithdrawal) {
                useBuffer = true; // Can cover full withdrawal
              } else {
                targetAmount = inflationAdjustedWithdrawal - bufferAmount; // Remaining from investments
              }
            }
            
            // Apply guardrails to investment portion (use full baseline for fair comparison)
            if (!useBuffer || bufferAmount < inflationAdjustedWithdrawal) {
              const currentPortfolioValue = pensionBal + taxFreeBal;
              targetAmount = getStrategyWithdrawalAmount(
                targetAmount,
                currentPortfolioValue,
                initialTotalBalance, // Use full baseline, not reduced
                month,
                withdrawalStrategy
              );
            }
          } else {
            // Other strategies
            const currentPortfolioValue = pensionBal + taxFreeBal;
            targetAmount = getStrategyWithdrawalAmount(
              inflationAdjustedWithdrawal,
              currentPortfolioValue,
              initialTotalBalance,
              month,
              withdrawalStrategy
            );
          }
          
          // Execute withdrawal
          if (useBuffer) {
            // Use buffer for full withdrawal
            cashBuffer -= inflationAdjustedWithdrawal;
          } else {
            // Partial buffer use + investment withdrawal
            if (bufferAmount > 0) {
              cashBuffer -= bufferAmount;
            }
            
            const withdrawal = calculateOptimalWithdrawal(
              pensionBal,
              taxFreeBal,
              targetAmount,
              currentRetirementAge
            );
            
            const totalNetIncome = withdrawal.netIncome + bufferAmount;
            if (totalNetIncome < targetAmount * (1 - WITHDRAWAL_TOLERANCE)) {
              simulationSuccess = false;
              break;
            }
            
            pensionBal = Math.max(0, pensionBal - withdrawal.pensionWithdrawal);
            taxFreeBal = Math.max(0, taxFreeBal - withdrawal.taxFreeWithdrawal);
            
            // Replenish buffer quarterly during strong 3-month performance (strategy 3 only)
            if (withdrawalStrategy === 3 && month % 3 === 0 && recentReturns.length === 3) {
              // Calculate actual 3-month compound return
              let portfolioReturn3Month = 1;
              for (let i = 0; i < recentReturns.length; i++) {
                portfolioReturn3Month *= (1 + recentReturns[i]);
              }
              portfolioReturn3Month -= 1; // Convert back to percentage
              
              // Adaptive replenishment based on bear market duration
              let replenishThreshold = QUARTERLY_REPLENISH_THRESHOLD;
              let maxReplenishMultiplier = 4; // Base: 4 months per quarter
              
              if (bearMarketMonths > 12) {
                // After prolonged downturn (12+ months), be very cautious
                replenishThreshold = QUARTERLY_REPLENISH_THRESHOLD * 1.5; // Need 6.75% quarterly return
                maxReplenishMultiplier = 2; // Only 2 months per quarter
              } else if (bearMarketMonths > 6) {
                // After moderate downturn (6-12 months), be somewhat cautious
                replenishThreshold = QUARTERLY_REPLENISH_THRESHOLD * 1.25; // Need 5.6% quarterly return
                maxReplenishMultiplier = 3; // Only 3 months per quarter
              }
              
              if (portfolioReturn3Month > replenishThreshold) {
                // Buffer target grows slowly (half inflation rate)
                const currentBufferTarget = initialBufferTarget * Math.pow(1 + (inflationRate / 2), yearsIntoRetirement);
                const bufferShortfall = currentBufferTarget - cashBuffer;
                
                if (bufferShortfall > inflationAdjustedWithdrawal * 2) {
                  const maxReplenish = Math.min(
                    inflationAdjustedWithdrawal * maxReplenishMultiplier,
                    taxFreeBal * 0.05,
                    bufferShortfall
                  );
                  if (maxReplenish > 0) {
                    taxFreeBal = Math.max(0, taxFreeBal - maxReplenish);
                    cashBuffer += maxReplenish;
                  }
                }
              }
            }
          }
          
          // Check if all funds depleted
          if (pensionBal <= 0 && taxFreeBal <= 0 && cashBuffer <= 0 && currentRetirementAge < 95) {
            simulationSuccess = false;
            break;
          }
        }
        
        if (simulationSuccess) {
          successfulSimulations++;
          totalPensionAtRetirement += retirementPensionBalance;
          totalTaxFreeAtRetirement += retirementTaxFreeBalance;
        }
      }
      
      const successRate = successfulSimulations / simulations;
      const avgPensionAtRetirement = successfulSimulations > 0 ? 
        totalPensionAtRetirement / successfulSimulations : 0;
      const avgTaxFreeAtRetirement = successfulSimulations > 0 ? 
        totalTaxFreeAtRetirement / successfulSimulations : 0;
      
      return {
        successRate,
        avgPensionAtRetirement,
        avgTaxFreeAtRetirement
      };
    }

    // Binary search for minimum saving months
    let left = 0;
    let right = maxSavingMonths;
    let bestResult = null;
    
    while (left <= right) {
      const savingMonths = Math.floor((left + right) / 2);
      const result = simulateRetirement(savingMonths);
      
      if (result.successRate >= targetSuccessRate) {
        bestResult = { 
          monthsNeeded: savingMonths,
          successRate: result.successRate,
          targetPensionBalance: result.avgPensionAtRetirement,
          targetTaxFreeBalance: result.avgTaxFreeAtRetirement
        };
        right = savingMonths - 1;
      } else {
        left = savingMonths + 1;
      }
    }

    if (bestResult && bestResult.monthsNeeded <= maxSavingMonths) {
      return [
        bestResult.monthsNeeded / 12,
        Math.round(bestResult.targetPensionBalance),
        Math.round(bestResult.targetTaxFreeBalance)
      ];
    } else {
      return [-1, 0, 0];
    }
    
  } catch (error) {
    return [-2, 0, 0];
  }
}

/**
 * Test different withdrawal strategies with and without bond tent
 */
function testWithdrawalStrategies() {
  console.log("=== Withdrawal Strategy Comparison ===");
  
  const strategies = [
    { id: 1, name: "Fixed Withdrawal" },
    { id: 2, name: "Guardrails Strategy" },
    { id: 3, name: "Cash Buffer Strategy" },
    { id: 4, name: "Essential/Discretionary (70/30)" }
  ];
  
  console.log("\n--- WITHOUT Bond Tent (100% Stocks) ---");
  strategies.forEach(strategy => {
    console.log(`\n${strategy.name}:`);
    const result = calculateSavingMonthsForRetirement(
      460000, 470000, 4000, 4000, 0.07, 0.15, 4000, 40, 0.9, 0.025, strategy.id, 0.7, 600, 1000, false
    );
    
    if (result[0] > 0) {
      console.log(`  Years needed: ${result[0].toFixed(1)}`);
      console.log(`  Target pension: £${result[1].toLocaleString()}`);
      console.log(`  Target tax-free: £${result[2].toLocaleString()}`);
    } else if (result[0] === -1) {
      console.log("  Not achievable within time limit");
    } else {
      console.log("  Error in calculation");
    }
  });
  
  console.log("\n--- WITH Bond Tent (60% → 40% Stocks over 10 years) ---");
  strategies.forEach(strategy => {
    console.log(`\n${strategy.name}:`);
    const result = calculateSavingMonthsForRetirement(
      460000, 470000, 4000, 4000, 0.07, 0.15, 4000, 40, 0.9, 0.025, strategy.id, 0.7, 600, 1000, 
      true, 0.03, 0.05, 0.6, 0.4, 10
    );
    
    if (result[0] > 0) {
      console.log(`  Years needed: ${result[0].toFixed(1)}`);
      console.log(`  Target pension: £${result[1].toLocaleString()}`);
      console.log(`  Target tax-free: £${result[2].toLocaleString()}`);
    } else if (result[0] === -1) {
      console.log("  Not achievable within time limit");
    } else {
      console.log("  Error in calculation");
    }
  });
}

/**
 * Option Chain Service
 * Fetches option chain data from Groww API and structures it for the frontend
 */

export interface OptionData {
  tradingSymbol: string;
  ltp: number;
  dayChange: number;
  dayChangePerc: number;
  oi: number;
  oiChangePerc: number;
  volume: number;
  iv?: number;
  bidPrice?: number;
  askPrice?: number;
}

export interface OptionChainStrike {
  strikePrice: number;
  ce: OptionData | null;
  pe: OptionData | null;
}

export interface OptionChainExpiry {
  expiryDate: string;
  strikes: OptionChainStrike[];
}

export interface OptionChainResult {
  searchId: string;
  spotPrice: number;
  expiryDates: string[];
  chains: Record<string, OptionChainStrike[]>; // keyed by expiry date
}

/**
 * Fetches and parses option chain data for a given underlying instrument
 */
export async function fetchOptionChain(
  searchId: string,
  _expiry?: string,
): Promise<OptionChainResult> {
  const url = `https://groww.in/v1/api/stocks_fo_data/v4/option_chain/${encodeURIComponent(searchId)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch option chain for ${searchId}: ${response.status} ${response.statusText}`,
    );
  }

  const data: any = await response.json();

  // Parse the Groww option chain response
  const spotPrice = data.spotPrice ?? data.ltp ?? 0;

  // Extract all available expiry dates
  const allExpiries: string[] = [];
  const chains: Record<string, OptionChainStrike[]> = {};

  // Groww returns data in optionChainDataBySeries -> optionChainData
  const seriesData = data.optionChains ?? data.optionChainDataBySeries ?? [];

  // Handle different response shapes
  const expiryList: any[] = Array.isArray(seriesData)
    ? seriesData
    : (seriesData?.optionChainData ?? []);

  for (const expiryGroup of expiryList) {
    const expiryDate =
      expiryGroup.expiryDate ?? expiryGroup.expiry ?? expiryGroup.expiryDateStr;

    if (!expiryDate) continue;
    allExpiries.push(expiryDate);

    const strikesMap = new Map<number, OptionChainStrike>();

    // Parse both CE and PE arrays
    const optionEntries: any[] =
      expiryGroup.optionChainDetails ??
      expiryGroup.optionData ??
      expiryGroup.options ??
      [];

    for (const entry of optionEntries) {
      const strike = entry.strikePrice ?? entry.strike;
      if (strike == null) continue;

      if (!strikesMap.has(strike)) {
        strikesMap.set(strike, { strikePrice: strike, ce: null, pe: null });
      }

      const strikeRow = strikesMap.get(strike)!;
      const optionType =
        entry.optionType ?? entry.type ?? (entry.callOption ? "CE" : "PE");

      const optionData: OptionData = {
        tradingSymbol:
          entry.tradingSymbol ?? entry.growwContractId ?? entry.symbol ?? "",
        ltp: entry.ltp ?? entry.lastPrice ?? 0,
        dayChange: entry.dayChange ?? 0,
        dayChangePerc: entry.dayChangePerc ?? 0,
        oi: entry.openInterest ?? entry.oi ?? 0,
        oiChangePerc: entry.oiChangePerc ?? entry.oiDayChangePerc ?? 0,
        volume: entry.volume ?? entry.totalTradedVolume ?? 0,
        iv: entry.iv ?? entry.impliedVolatility ?? undefined,
        bidPrice: entry.bidPrice ?? entry.bidprice ?? undefined,
        askPrice: entry.askPrice ?? entry.askprice ?? undefined,
      };

      // Handle Groww's nested callOption/putOption format
      if (entry.callOption) {
        const ce = entry.callOption;
        strikeRow.ce = {
          tradingSymbol: ce.growwContractId ?? ce.tradingSymbol ?? "",
          ltp: ce.ltp ?? 0,
          dayChange: ce.dayChange ?? 0,
          dayChangePerc: ce.dayChangePerc ?? 0,
          oi: ce.openInterest ?? ce.oi ?? 0,
          oiChangePerc: ce.oiDayChangePerc ?? ce.oiChangePerc ?? 0,
          volume: ce.volume ?? 0,
          iv: ce.iv ?? undefined,
          bidPrice: ce.bidPrice ?? undefined,
          askPrice: ce.askPrice ?? undefined,
        };
      }

      if (entry.putOption) {
        const pe = entry.putOption;
        strikeRow.pe = {
          tradingSymbol: pe.growwContractId ?? pe.tradingSymbol ?? "",
          ltp: pe.ltp ?? 0,
          dayChange: pe.dayChange ?? 0,
          dayChangePerc: pe.dayChangePerc ?? 0,
          oi: pe.openInterest ?? pe.oi ?? 0,
          oiChangePerc: pe.oiDayChangePerc ?? pe.oiChangePerc ?? 0,
          volume: pe.volume ?? 0,
          iv: pe.iv ?? undefined,
          bidPrice: pe.bidPrice ?? undefined,
          askPrice: pe.askPrice ?? undefined,
        };
      }

      // Handle flat structure with optionType
      if (
        !entry.callOption &&
        !entry.putOption &&
        (optionType === "CE" || optionType === "CALL")
      ) {
        strikeRow.ce = optionData;
      } else if (
        !entry.callOption &&
        !entry.putOption &&
        (optionType === "PE" || optionType === "PUT")
      ) {
        strikeRow.pe = optionData;
      }
    }

    // Sort strikes by strike price
    const strikes = Array.from(strikesMap.values()).sort(
      (a, b) => a.strikePrice - b.strikePrice,
    );

    chains[expiryDate] = strikes;
  }

  // If no structured data was found, pass through the raw data
  if (allExpiries.length === 0 && data) {
    // Attempt fallback parsing from the raw response
    console.log(
      "Option chain: no structured data found, raw keys:",
      Object.keys(data),
    );
  }

  return {
    searchId,
    spotPrice,
    expiryDates: allExpiries,
    chains,
  };
}

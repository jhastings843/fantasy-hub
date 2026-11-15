import type { Satellite } from "./types";

// A real site-watch data/status.json (2026-11-14 evening, with market cards), the exact shape trade-bot passes through as snapshot.satellite.
// The type annotation makes tsc check it against the Satellite type.
export const satelliteFixture: Satellite = {
  "version": 1,
  "generatedAt": "2026-11-15T00:26:10+00:00",
  "bankroll": 1000.0,
  "cash": 911.95,
  "equity": 981.69,
  "realizedPnl": 0,
  "fees": 3.99,
  "openCost": 84.06,
  "openValue": 69.74,
  "openFees": 3.99,
  "settled": 0,
  "wins": 0,
  "curve": [
    {
      "day": "2026-11-14",
      "equity": 981.69
    }
  ],
  "rules": {
    "minEdge": 0.05,
    "kelly": 0.25,
    "maxPerMarket": 40.0,
    "maxPerEvent": 100.0,
    "maxOpenShare": 0.5
  },
  "signals": [
    {
      "id": "hmonth-2026-11",
      "family": "global-temp",
      "venue": "kalshi",
      "ticker": "KXHMONTH-26NOV",
      "title": "Will  Nov 2026 be the hottest Nov ever?",
      "label": "Hottest ever",
      "url": "https://kalshi.com/markets/kxhmonth",
      "p": 0.8118,
      "yesBid": 0.88,
      "yesAsk": 0.9,
      "best": {
        "side": "no",
        "ask": 0.12,
        "edge": 0.0608
      },
      "action": "already holding",
      "why": "ERA5 has 12 of 30 days; NOAA November est 1.53 +/- 0.09 C vs record 1.40",
      "model": {
        "mu": 1.5308,
        "sd": 0.0886,
        "era_est": 1.0337,
        "days_known": 12,
        "days": 30,
        "bias": -0.0057,
        "map_sd": 0.0349,
        "est_sd": 0.0807,
        "raw": 0.922,
        "record": 1.4
      },
      "closes": "2026-12-16T04:59:00Z"
    },
    {
      "id": "gtemp-2026-KXGTEMP-27-P0",
      "family": "global-temp",
      "venue": "kalshi",
      "ticker": "KXGTEMP-27-P0",
      "title": "Will 2026 be the hottest year on record?",
      "label": "Hottest",
      "url": "https://kalshi.com/markets/kxgtemp",
      "p": 0.9713,
      "yesBid": 0.91,
      "yesAsk": 0.92,
      "best": {
        "side": "yes",
        "ask": 0.92,
        "edge": 0.0461
      },
      "action": "edge +4.6c under 5c",
      "why": "GISS 2026 annual est 1.323 +/- 0.020 C (months forecast: [11, 12]) vs needed above 1.28",
      "model": {
        "mu": 1.3235,
        "sd": 0.0202,
        "need": 1.28,
        "raw": 0.9719
      },
      "closes": "2027-01-01T04:59:00Z"
    },
    {
      "id": "gtemp-2026-KXGTEMP-26-P0",
      "family": "global-temp",
      "venue": "kalshi",
      "ticker": "KXGTEMP-26-P0",
      "title": "Will 2026 be the hottest year on record?",
      "label": "Hottest",
      "url": "https://kalshi.com/markets/kxgtemp",
      "p": 0.9713,
      "yesBid": 0.865,
      "yesAsk": 0.873,
      "best": {
        "side": "yes",
        "ask": 0.873,
        "edge": 0.0905
      },
      "action": "already holding",
      "why": "GISS 2026 annual est 1.323 +/- 0.020 C (months forecast: [11, 12]) vs needed above 1.28",
      "model": {
        "mu": 1.3235,
        "sd": 0.0202,
        "need": 1.28,
        "raw": 0.9719
      },
      "closes": "2027-01-01T04:59:00Z"
    },
    {
      "id": "poly-2026-11-<1.35ºC",
      "family": "global-temp",
      "venue": "polymarket",
      "ticker": "will-global-temperature-increase-by-less-than-1pt35c-in-november-2026",
      "title": "November 2026 Temperature Increase (ºC)",
      "label": "<1.35ºC",
      "url": "https://polymarket.com/event/november-2026-temperature-increase-c",
      "p": 0.0015,
      "yesBid": 0.002,
      "yesAsk": 0.009,
      "best": null,
      "action": "no usable price",
      "why": "GISS November est 1.63 +/- 0.10 C (recent GISS bias +0.04)",
      "model": {
        "mu": 1.6281,
        "sd": 0.0951,
        "lo": null,
        "hi": 1.34
      },
      "closes": "2027-01-02T04:59:00Z"
    },
    {
      "id": "poly-2026-11-1.35–1.39ºC",
      "family": "global-temp",
      "venue": "polymarket",
      "ticker": "will-global-temperature-increase-by-between-1pt35c-and-1pt39c-in-november-2026",
      "title": "November 2026 Temperature Increase (ºC)",
      "label": "1.35–1.39ºC",
      "url": "https://polymarket.com/event/november-2026-temperature-increase-c",
      "p": 0.0057,
      "yesBid": 0.002,
      "yesAsk": 0.009,
      "best": null,
      "action": "no usable price",
      "why": "GISS November est 1.63 +/- 0.10 C (recent GISS bias +0.04)",
      "model": {
        "mu": 1.6281,
        "sd": 0.0951,
        "lo": 1.35,
        "hi": 1.39
      },
      "closes": "2027-01-02T04:59:00Z"
    },
    {
      "id": "poly-2026-11-1.40–1.44ºC",
      "family": "global-temp",
      "venue": "polymarket",
      "ticker": "will-global-temperature-increase-by-between-1pt40c-and-1pt44c-in-november-2026",
      "title": "November 2026 Temperature Increase (ºC)",
      "label": "1.40–1.44ºC",
      "url": "https://polymarket.com/event/november-2026-temperature-increase-c",
      "p": 0.0199,
      "yesBid": 0.003,
      "yesAsk": 0.027,
      "best": null,
      "action": "no usable price",
      "why": "GISS November est 1.63 +/- 0.10 C (recent GISS bias +0.04)",
      "model": {
        "mu": 1.6281,
        "sd": 0.0951,
        "lo": 1.4,
        "hi": 1.44
      },
      "closes": "2027-01-02T04:59:00Z"
    },
    {
      "id": "poly-2026-11-1.45–1.49ºC",
      "family": "global-temp",
      "venue": "polymarket",
      "ticker": "will-global-temperature-increase-by-between-1pt45c-and-1pt49c-in-november-2026",
      "title": "November 2026 Temperature Increase (ºC)",
      "label": "1.45–1.49ºC",
      "url": "https://polymarket.com/event/november-2026-temperature-increase-c",
      "p": 0.0537,
      "yesBid": 0.01,
      "yesAsk": 0.032,
      "best": {
        "side": "yes",
        "ask": 0.032,
        "edge": 0.0217
      },
      "action": "edge +2.2c under 5c",
      "why": "GISS November est 1.63 +/- 0.10 C (recent GISS bias +0.04)",
      "model": {
        "mu": 1.6281,
        "sd": 0.0951,
        "lo": 1.45,
        "hi": 1.49
      },
      "closes": "2027-01-02T04:59:00Z"
    },
    {
      "id": "poly-2026-11-1.50–1.54ºC",
      "family": "global-temp",
      "venue": "polymarket",
      "ticker": "will-global-temperature-increase-by-between-1pt50c-and-1pt54c-in-november-2026",
      "title": "November 2026 Temperature Increase (ºC)",
      "label": "1.50–1.54ºC",
      "url": "https://polymarket.com/event/november-2026-temperature-increase-c",
      "p": 0.1103,
      "yesBid": 0.07,
      "yesAsk": 0.11,
      "best": {
        "side": "yes",
        "ask": 0.11,
        "edge": 0.0003
      },
      "action": "edge +0.0c under 5c",
      "why": "GISS November est 1.63 +/- 0.10 C (recent GISS bias +0.04)",
      "model": {
        "mu": 1.6281,
        "sd": 0.0951,
        "lo": 1.5,
        "hi": 1.54
      },
      "closes": "2027-01-02T04:59:00Z"
    },
    {
      "id": "poly-2026-11->1.54ºC",
      "family": "global-temp",
      "venue": "polymarket",
      "ticker": "will-global-temperature-increase-by-more-than-1pt54c-in-november-2026",
      "title": "November 2026 Temperature Increase (ºC)",
      "label": ">1.54ºC",
      "url": "https://polymarket.com/event/november-2026-temperature-increase-c",
      "p": 0.809,
      "yesBid": 0.87,
      "yesAsk": 0.92,
      "best": {
        "side": "no",
        "ask": 0.13,
        "edge": 0.061
      },
      "action": "already holding",
      "why": "GISS November est 1.63 +/- 0.10 C (recent GISS bias +0.04)",
      "model": {
        "mu": 1.6281,
        "sd": 0.0951,
        "lo": 1.55,
        "hi": null
      },
      "closes": "2027-01-02T04:59:00Z"
    },
    {
      "id": "icemax-2027-15.2",
      "family": "sea-ice",
      "venue": "kalshi",
      "ticker": "KXARCTICICEMAX-27APR01-T15.2",
      "title": "Will the extent of the Arctic sea ice be above 15.2 million square km at any point between December 18, 2026 and April 01, 2027?",
      "label": "Above 15.2 million sq km",
      "url": "https://kalshi.com/markets/kxarcticicemax",
      "p": 0.0147,
      "yesBid": 0.03,
      "yesAsk": 0.04,
      "best": {
        "side": "no",
        "ask": 0.97,
        "edge": 0.0132
      },
      "action": "edge +1.3c under 5c",
      "why": "Extent now 8.80M km2; past seasons' growth puts the max near 14.45M; level 15.2",
      "model": {
        "base": 8.802,
        "median_max": 14.455,
        "sd": 0.342,
        "seasons": 37,
        "method": "regression",
        "so_far": null,
        "level": 15.2,
        "raw": 0.0147
      },
      "closes": "2027-04-02T03:59:00Z"
    },
    {
      "id": "icemax-2027-15.0",
      "family": "sea-ice",
      "venue": "kalshi",
      "ticker": "KXARCTICICEMAX-27APR01-T15.0",
      "title": "Will the extent of the Arctic sea ice be above 15.0 million square km at any point between December 18, 2026 and April 01, 2027?",
      "label": "Above 15.0 million sq km",
      "url": "https://kalshi.com/markets/kxarcticicemax",
      "p": 0.0555,
      "yesBid": 0.05,
      "yesAsk": 0.06,
      "best": {
        "side": "yes",
        "ask": 0.06,
        "edge": -0.0085
      },
      "action": "edge -0.8c under 5c",
      "why": "Extent now 8.80M km2; past seasons' growth puts the max near 14.45M; level 15.0",
      "model": {
        "base": 8.802,
        "median_max": 14.455,
        "sd": 0.342,
        "seasons": 37,
        "method": "regression",
        "so_far": null,
        "level": 15.0,
        "raw": 0.0555
      },
      "closes": "2027-04-02T03:59:00Z"
    },
    {
      "id": "icemax-2027-14.8",
      "family": "sea-ice",
      "venue": "kalshi",
      "ticker": "KXARCTICICEMAX-27APR01-T14.8",
      "title": "Will the extent of the Arctic sea ice be above 14.8 million square km at any point between December 18, 2026 and April 01, 2027?",
      "label": "Above 14.8 million sq km",
      "url": "https://kalshi.com/markets/kxarcticicemax",
      "p": 0.1565,
      "yesBid": 0.09,
      "yesAsk": 0.14,
      "best": {
        "side": "yes",
        "ask": 0.14,
        "edge": 0.008
      },
      "action": "edge +0.8c under 5c",
      "why": "Extent now 8.80M km2; past seasons' growth puts the max near 14.45M; level 14.8",
      "model": {
        "base": 8.802,
        "median_max": 14.455,
        "sd": 0.342,
        "seasons": 37,
        "method": "regression",
        "so_far": null,
        "level": 14.8,
        "raw": 0.1565
      },
      "closes": "2027-04-02T03:59:00Z"
    },
    {
      "id": "icemax-2027-14.6",
      "family": "sea-ice",
      "venue": "kalshi",
      "ticker": "KXARCTICICEMAX-27APR01-T14.6",
      "title": "Will the extent of the Arctic sea ice be above 14.6 million square km at any point between December 18, 2026 and April 01, 2027?",
      "label": "Above 14.6 million sq km",
      "url": "https://kalshi.com/markets/kxarcticicemax",
      "p": 0.3357,
      "yesBid": 0.34,
      "yesAsk": 0.39,
      "best": {
        "side": "no",
        "ask": 0.66,
        "edge": -0.0115
      },
      "action": "edge -1.1c under 5c",
      "why": "Extent now 8.80M km2; past seasons' growth puts the max near 14.45M; level 14.6",
      "model": {
        "base": 8.802,
        "median_max": 14.455,
        "sd": 0.342,
        "seasons": 37,
        "method": "regression",
        "so_far": null,
        "level": 14.6,
        "raw": 0.3357
      },
      "closes": "2027-04-02T03:59:00Z"
    },
    {
      "id": "icemax-2027-14.4",
      "family": "sea-ice",
      "venue": "kalshi",
      "ticker": "KXARCTICICEMAX-27APR01-T14.4",
      "title": "Will the extent of the Arctic sea ice be above 14.4 million square km at any point between December 18, 2026 and April 01, 2027?",
      "label": "Above 14.4 million sq km",
      "url": "https://kalshi.com/markets/kxarcticicemax",
      "p": 0.5637,
      "yesBid": 0.48,
      "yesAsk": 0.52,
      "best": {
        "side": "yes",
        "ask": 0.52,
        "edge": 0.0262
      },
      "action": "edge +2.6c under 5c",
      "why": "Extent now 8.80M km2; past seasons' growth puts the max near 14.45M; level 14.4",
      "model": {
        "base": 8.802,
        "median_max": 14.455,
        "sd": 0.342,
        "seasons": 37,
        "method": "regression",
        "so_far": null,
        "level": 14.4,
        "raw": 0.5637
      },
      "closes": "2027-04-02T03:59:00Z"
    },
    {
      "id": "icemax-2027-14.3",
      "family": "sea-ice",
      "venue": "kalshi",
      "ticker": "KXARCTICICEMAX-27APR01-T14.3",
      "title": "Will the extent of the Arctic sea ice be above 14.3 million square km at any point between December 18, 2026 and April 01, 2027?",
      "label": "Above 14.3 million sq km",
      "url": "https://kalshi.com/markets/kxarcticicemax",
      "p": 0.6746,
      "yesBid": 0.71,
      "yesAsk": 0.76,
      "best": {
        "side": "no",
        "ask": 0.29,
        "edge": 0.0209
      },
      "action": "edge +2.1c under 5c",
      "why": "Extent now 8.80M km2; past seasons' growth puts the max near 14.45M; level 14.3",
      "model": {
        "base": 8.802,
        "median_max": 14.455,
        "sd": 0.342,
        "seasons": 37,
        "method": "regression",
        "so_far": null,
        "level": 14.3,
        "raw": 0.6746
      },
      "closes": "2027-04-02T03:59:00Z"
    },
    {
      "id": "icemax-2027-14.2",
      "family": "sea-ice",
      "venue": "kalshi",
      "ticker": "KXARCTICICEMAX-27APR01-T14.2",
      "title": "Will the extent of the Arctic sea ice be above 14.2 million square km at any point between December 18, 2026 and April 01, 2027?",
      "label": "Above 14.2 million sq km",
      "url": "https://kalshi.com/markets/kxarcticicemax",
      "p": 0.7718,
      "yesBid": 0.86,
      "yesAsk": 0.88,
      "best": {
        "side": "no",
        "ask": 0.14,
        "edge": 0.0797
      },
      "action": "already holding",
      "why": "Extent now 8.80M km2; past seasons' growth puts the max near 14.45M; level 14.2",
      "model": {
        "base": 8.802,
        "median_max": 14.455,
        "sd": 0.342,
        "seasons": 37,
        "method": "regression",
        "so_far": null,
        "level": 14.2,
        "raw": 0.7718
      },
      "closes": "2027-04-02T03:59:00Z"
    },
    {
      "id": "icemax-2027-14.1",
      "family": "sea-ice",
      "venue": "kalshi",
      "ticker": "KXARCTICICEMAX-27APR01-T14.1",
      "title": "Will the extent of the Arctic sea ice be above 14.1 million square km at any point between December 18, 2026 and April 01, 2027?",
      "label": "Above 14.1 million sq km",
      "url": "https://kalshi.com/markets/kxarcticicemax",
      "p": 0.8501,
      "yesBid": 0.91,
      "yesAsk": 0.92,
      "best": {
        "side": "no",
        "ask": 0.09,
        "edge": 0.0541
      },
      "action": "already holding",
      "why": "Extent now 8.80M km2; past seasons' growth puts the max near 14.45M; level 14.1",
      "model": {
        "base": 8.802,
        "median_max": 14.455,
        "sd": 0.342,
        "seasons": 37,
        "method": "regression",
        "so_far": null,
        "level": 14.1,
        "raw": 0.8501
      },
      "closes": "2027-04-02T03:59:00Z"
    },
    {
      "id": "icemax-2027-14.0",
      "family": "sea-ice",
      "venue": "kalshi",
      "ticker": "KXARCTICICEMAX-27APR01-T14.0",
      "title": "Will the extent of the Arctic sea ice be above 14.0 million square km at any point between December 18, 2026 and April 01, 2027?",
      "label": "Above 14.0 million sq km",
      "url": "https://kalshi.com/markets/kxarcticicemax",
      "p": 0.9081,
      "yesBid": 0.94,
      "yesAsk": 0.95,
      "best": {
        "side": "no",
        "ask": 0.06,
        "edge": 0.0279
      },
      "action": "edge +2.8c under 5c",
      "why": "Extent now 8.80M km2; past seasons' growth puts the max near 14.45M; level 14.0",
      "model": {
        "base": 8.802,
        "median_max": 14.455,
        "sd": 0.342,
        "seasons": 37,
        "method": "regression",
        "so_far": null,
        "level": 14.0,
        "raw": 0.9081
      },
      "closes": "2027-04-02T03:59:00Z"
    },
    {
      "id": "icemax-2027-13.9",
      "family": "sea-ice",
      "venue": "kalshi",
      "ticker": "KXARCTICICEMAX-27APR01-T13.9",
      "title": "Will the extent of the Arctic sea ice be above 13.9 million square km at any point between December 18, 2026 and April 01, 2027?",
      "label": "Above 13.9 million sq km",
      "url": "https://kalshi.com/markets/kxarcticicemax",
      "p": 0.9476,
      "yesBid": 0.95,
      "yesAsk": 0.97,
      "best": {
        "side": "no",
        "ask": 0.05,
        "edge": -0.001
      },
      "action": "edge -0.1c under 5c",
      "why": "Extent now 8.80M km2; past seasons' growth puts the max near 14.45M; level 13.9",
      "model": {
        "base": 8.802,
        "median_max": 14.455,
        "sd": 0.342,
        "seasons": 37,
        "method": "regression",
        "so_far": null,
        "level": 13.9,
        "raw": 0.9476
      },
      "closes": "2027-04-02T03:59:00Z"
    },
    {
      "id": "icemax-2027-13.8",
      "family": "sea-ice",
      "venue": "kalshi",
      "ticker": "KXARCTICICEMAX-27APR01-T13.8",
      "title": "Will the extent of the Arctic sea ice be above 13.8 million square km at any point between December 18, 2026 and April 01, 2027?",
      "label": "Above 13.8 million sq km",
      "url": "https://kalshi.com/markets/kxarcticicemax",
      "p": 0.9722,
      "yesBid": 0.96,
      "yesAsk": 0.97,
      "best": {
        "side": "yes",
        "ask": 0.97,
        "edge": 0.0001
      },
      "action": "edge +0.0c under 5c",
      "why": "Extent now 8.80M km2; past seasons' growth puts the max near 14.45M; level 13.8",
      "model": {
        "base": 8.802,
        "median_max": 14.455,
        "sd": 0.342,
        "seasons": 37,
        "method": "regression",
        "so_far": null,
        "level": 13.8,
        "raw": 0.9722
      },
      "closes": "2027-04-02T03:59:00Z"
    }
  ],
  "bets": [
    {
      "id": "KXGTEMP-26-P0:yes:2026-11-14",
      "placed": "2026-11-14T23:07:28+00:00",
      "venue": "kalshi",
      "event": "KXGTEMP-26",
      "ticker": "KXGTEMP-26-P0",
      "title": "Will 2026 be the hottest year on record?",
      "label": "Hottest",
      "signal": "gtemp-2026-KXGTEMP-26-P0",
      "side": "yes",
      "price": 0.915,
      "contracts": 3,
      "cost": 2.75,
      "fee": 0.02,
      "p": 0.9713,
      "edge": 0.0508,
      "why": "GISS 2026 annual est 1.323 +/- 0.020 C (months forecast: [11, 12]) vs needed above 1.28",
      "url": "https://kalshi.com/markets/kxgtemp",
      "status": "open"
    },
    {
      "id": "will-global-temperature-increase-by-more-than-1pt54c-in-november-2026:no:2026-11-14",
      "placed": "2026-11-14T23:05:02+00:00",
      "venue": "polymarket",
      "event": "november-2026-temperature-increase-c",
      "ticker": "will-global-temperature-increase-by-more-than-1pt54c-in-november-2026",
      "title": "November 2026 Temperature Increase (ºC)",
      "label": ">1.54ºC",
      "signal": "poly-2026-11->1.54ºC",
      "side": "no",
      "price": 0.13,
      "contracts": 134,
      "cost": 17.42,
      "fee": 0.0,
      "p": 0.191,
      "edge": 0.061,
      "why": "GISS November est 1.63 +/- 0.10 C (recent GISS bias +0.04)",
      "url": "https://polymarket.com/event/november-2026-temperature-increase-c",
      "status": "open"
    },
    {
      "id": "KXARCTICICEMAX-27APR01-T14.2:no:2026-11-14",
      "placed": "2026-11-14T23:05:02+00:00",
      "venue": "kalshi",
      "event": "KXARCTICICEMAX-27APR01",
      "ticker": "KXARCTICICEMAX-27APR01-T14.2",
      "title": "Will the extent of the Arctic sea ice be above 14.2 million square km at any point between December 18, 2026 and April 01, 2027?",
      "label": "Above 14.2 million sq km",
      "signal": "icemax-2027-14.2",
      "side": "no",
      "price": 0.14,
      "contracts": 183,
      "cost": 25.62,
      "fee": 1.55,
      "p": 0.2282,
      "edge": 0.0797,
      "why": "Extent now 8.80M km2; past seasons' growth puts the max near 14.45M; level 14.2",
      "url": "https://kalshi.com/markets/kxarcticicemax",
      "status": "open"
    },
    {
      "id": "KXHMONTH-26NOV:no:2026-11-14",
      "placed": "2026-11-14T23:05:02+00:00",
      "venue": "kalshi",
      "event": "KXHMONTH-26NOV",
      "ticker": "KXHMONTH-26NOV",
      "title": "Will  Nov 2026 be the hottest Nov ever?",
      "label": "Hottest ever",
      "signal": "hmonth-2026-11",
      "side": "no",
      "price": 0.11,
      "contracts": 199,
      "cost": 21.89,
      "fee": 1.37,
      "p": 0.1882,
      "edge": 0.0713,
      "why": "ERA5 has 12 of 30 days; NOAA November est 1.53 +/- 0.09 C vs record 1.40",
      "url": "https://kalshi.com/markets/kxhmonth",
      "status": "open"
    },
    {
      "id": "KXARCTICICEMAX-27APR01-T14.1:no:2026-11-14",
      "placed": "2026-11-14T23:05:02+00:00",
      "venue": "kalshi",
      "event": "KXARCTICICEMAX-27APR01",
      "ticker": "KXARCTICICEMAX-27APR01-T14.1",
      "title": "Will the extent of the Arctic sea ice be above 14.1 million square km at any point between December 18, 2026 and April 01, 2027?",
      "label": "Above 14.1 million sq km",
      "signal": "icemax-2027-14.1",
      "side": "no",
      "price": 0.09,
      "contracts": 182,
      "cost": 16.38,
      "fee": 1.05,
      "p": 0.1499,
      "edge": 0.0541,
      "why": "Extent now 8.80M km2; past seasons' growth puts the max near 14.45M; level 14.1",
      "url": "https://kalshi.com/markets/kxarcticicemax",
      "status": "open"
    }
  ],
  "events": [
    {
      "event": "KXHMONTH-26NOV",
      "family": "global-temp",
      "venue": "kalshi",
      "url": "https://kalshi.com/markets/kxhmonth",
      "title": "Will  Nov 2026 be the hottest Nov ever?",
      "read": "Bet No on Hottest ever: we give it 19%, it cost 11c.",
      "levels": [
        "hmonth-2026-11"
      ],
      "bets": [
        "KXHMONTH-26NOV:no:2026-11-14"
      ],
      "images": [],
      "facts": [
        "12 of 30 days are in from ERA5, a daily global reading built largely from satellites. The rest of the month is assumed to look like the last week.",
        "That points to 1.53 C on NOAA's scale, give or take 0.08 (about 2 in 3 months land inside that range).",
        "Warmest so far: 2023 at 1.40, 2024 at 1.30, 2025 at 1.13.",
        "NOAA publishes around the 8th to 14th of next month; the market settles then."
      ],
      "series": [
        {
          "label": "November 2026, daily global reading (ERA5)",
          "points": [
            [
              "2026-11-01",
              1.077
            ],
            [
              "2026-11-02",
              1.11
            ],
            [
              "2026-11-03",
              1.155
            ],
            [
              "2026-11-04",
              1.15
            ],
            [
              "2026-11-05",
              1.114
            ],
            [
              "2026-11-06",
              1.036
            ],
            [
              "2026-11-07",
              0.983
            ],
            [
              "2026-11-08",
              0.984
            ],
            [
              "2026-11-09",
              0.975
            ],
            [
              "2026-11-10",
              1.003
            ],
            [
              "2026-11-11",
              1.03
            ],
            [
              "2026-11-12",
              1.102
            ]
          ]
        }
      ],
      "lines": [
        {
          "label": "Needed to beat the record (1.40 on NOAA's scale)",
          "value": 0.888
        }
      ],
      "question": "Will November 2026 be the warmest November on record?"
    },
    {
      "event": "gtemp-2026",
      "family": "global-temp",
      "venue": "kalshi",
      "url": "https://kalshi.com/markets/kxgtemp",
      "title": "Will 2026 be the hottest year on record?",
      "read": "Bet Yes on Hottest: we give it 97%, it cost 92c.",
      "levels": [
        "gtemp-2026-KXGTEMP-27-P0",
        "gtemp-2026-KXGTEMP-26-P0"
      ],
      "bets": [
        "KXGTEMP-26-P0:yes:2026-11-14"
      ],
      "images": [],
      "facts": [
        "10 months are published. The rest are forecast from ERA5's daily readings.",
        "The year averages out near 1.323 C, give or take 0.020. It needs to beat 1.28.",
        "Last year: 1.19. Record before this year: 1.28."
      ],
      "series": [
        {
          "label": "2026, NASA monthly global temperature",
          "points": [
            [
              "2026-01",
              1.08
            ],
            [
              "2026-02",
              1.23
            ],
            [
              "2026-03",
              1.3
            ],
            [
              "2026-04",
              1.16
            ],
            [
              "2026-05",
              1.13
            ],
            [
              "2026-06",
              1.18
            ],
            [
              "2026-07",
              1.24
            ],
            [
              "2026-08",
              1.42
            ],
            [
              "2026-09",
              1.39
            ],
            [
              "2026-10",
              1.55
            ]
          ],
          "monthly": true
        }
      ],
      "lines": [
        {
          "label": "Year average needed (1.28+)",
          "value": 1.28
        }
      ],
      "question": "Will 2026 be the hottest year on NASA's record?"
    },
    {
      "event": "november-2026-temperature-increase-c",
      "family": "global-temp",
      "venue": "polymarket",
      "url": "https://polymarket.com/event/november-2026-temperature-increase-c",
      "title": "November 2026 Temperature Increase (ºC)",
      "read": "Bet No on >1.54ºC: we give it 19%, it cost 13c.",
      "levels": [
        "poly-2026-11-<1.35ºC",
        "poly-2026-11-1.35–1.39ºC",
        "poly-2026-11-1.40–1.44ºC",
        "poly-2026-11-1.45–1.49ºC",
        "poly-2026-11-1.50–1.54ºC",
        "poly-2026-11->1.54ºC"
      ],
      "bets": [
        "will-global-temperature-increase-by-more-than-1pt54c-in-november-2026:no:2026-11-14"
      ],
      "images": [],
      "facts": [
        "12 of 30 days are in from ERA5, a daily global reading built largely from satellites. The rest of the month is assumed to look like the last week.",
        "That points to 1.63 C on NASA's scale, give or take 0.09 (about 2 in 3 months land inside that range).",
        "Warmest so far: 2023 at 1.40, 2024 at 1.29, 2025 at 1.21.",
        "NASA publishes around the 8th to 14th of next month; the market settles then.",
        "NASA has run +0.04 C against ERA5 lately; the estimate includes that."
      ],
      "series": [
        {
          "label": "November 2026, daily global reading (ERA5)",
          "points": [
            [
              "2026-11-01",
              1.077
            ],
            [
              "2026-11-02",
              1.11
            ],
            [
              "2026-11-03",
              1.155
            ],
            [
              "2026-11-04",
              1.15
            ],
            [
              "2026-11-05",
              1.114
            ],
            [
              "2026-11-06",
              1.036
            ],
            [
              "2026-11-07",
              0.983
            ],
            [
              "2026-11-08",
              0.984
            ],
            [
              "2026-11-09",
              0.975
            ],
            [
              "2026-11-10",
              1.003
            ],
            [
              "2026-11-11",
              1.03
            ],
            [
              "2026-11-12",
              1.102
            ]
          ]
        }
      ],
      "lines": [
        {
          "label": "Needed to beat the record (1.40 on NASA's scale)",
          "value": 0.79
        }
      ],
      "question": "How warm will November 2026 come in on NASA's index?"
    },
    {
      "event": "KXARCTICICEMAX-27APR01",
      "family": "sea-ice",
      "venue": "kalshi",
      "url": "https://kalshi.com/markets/kxarcticicemax",
      "title": "Will the extent of the Arctic sea ice be above 15.2 million square km at any point between December 18, 2026 and April 01, 2027?",
      "read": "Bet No on Above 14.2 million sq km (and 1 more): we give it 23%, it cost 14c.",
      "levels": [
        "icemax-2027-15.2",
        "icemax-2027-15.0",
        "icemax-2027-14.8",
        "icemax-2027-14.6",
        "icemax-2027-14.4",
        "icemax-2027-14.3",
        "icemax-2027-14.2",
        "icemax-2027-14.1",
        "icemax-2027-14.0",
        "icemax-2027-13.9",
        "icemax-2027-13.8"
      ],
      "bets": [
        "KXARCTICICEMAX-27APR01-T14.2:no:2026-11-14",
        "KXARCTICICEMAX-27APR01-T14.1:no:2026-11-14"
      ],
      "images": [
        {
          "url": "https://noaadata.apps.nsidc.org/NOAA/G02135/north/daily/images/2026/11_Nov/N_20261113_conc_v4.0.png",
          "caption": "Sea ice today (Nov 13, 2026), NSIDC satellite map. Orange line: the usual edge for this date (1981-2010)."
        },
        {
          "url": "https://noaadata.apps.nsidc.org/NOAA/G02135/north/daily/images/2025/11_Nov/N_20251113_conc_v4.0.png",
          "caption": "Same day last year (Nov 13, 2025)."
        }
      ],
      "facts": [
        "Extent now: 8.80 million km2, measured daily by satellite (NSIDC), which is what Kalshi settles on.",
        "Expected peak: about 14.46, give or take 0.34.",
        "Recent peaks: 2020-21 14.87, 2021-22 14.94, 2022-23 14.64, 2023-24 15.04, 2024-25 14.35, 2025-26 14.36.",
        "Low starts tend to catch up over winter, so a small November does not mean a small peak."
      ],
      "series": [
        {
          "label": "2026 (now)",
          "points": [
            [
              "2026-09-01",
              4.733
            ],
            [
              "2026-09-02",
              4.674
            ],
            [
              "2026-09-03",
              4.656
            ],
            [
              "2026-09-04",
              4.69
            ],
            [
              "2026-09-05",
              4.668
            ],
            [
              "2026-09-06",
              4.632
            ],
            [
              "2026-09-07",
              4.596
            ],
            [
              "2026-09-08",
              4.59
            ],
            [
              "2026-09-09",
              4.615
            ],
            [
              "2026-09-10",
              4.609
            ],
            [
              "2026-09-11",
              4.6
            ],
            [
              "2026-09-12",
              4.574
            ],
            [
              "2026-09-13",
              4.595
            ],
            [
              "2026-09-14",
              4.651
            ],
            [
              "2026-09-15",
              4.724
            ],
            [
              "2026-09-16",
              4.656
            ],
            [
              "2026-09-17",
              4.634
            ],
            [
              "2026-09-18",
              4.666
            ],
            [
              "2026-09-19",
              4.708
            ],
            [
              "2026-09-20",
              4.709
            ],
            [
              "2026-09-21",
              4.772
            ],
            [
              "2026-09-22",
              4.868
            ],
            [
              "2026-09-23",
              4.95
            ],
            [
              "2026-09-24",
              4.993
            ],
            [
              "2026-09-25",
              5.169
            ],
            [
              "2026-09-26",
              5.164
            ],
            [
              "2026-09-27",
              5.228
            ],
            [
              "2026-09-28",
              5.333
            ],
            [
              "2026-09-29",
              5.378
            ],
            [
              "2026-09-30",
              5.478
            ],
            [
              "2026-10-01",
              5.65
            ],
            [
              "2026-10-02",
              5.714
            ],
            [
              "2026-10-03",
              5.771
            ],
            [
              "2026-10-04",
              5.8
            ],
            [
              "2026-10-05",
              5.86
            ],
            [
              "2026-10-06",
              5.959
            ],
            [
              "2026-10-07",
              6.007
            ],
            [
              "2026-10-08",
              6.073
            ],
            [
              "2026-10-09",
              6.018
            ],
            [
              "2026-10-10",
              6.076
            ],
            [
              "2026-10-11",
              6.178
            ],
            [
              "2026-10-12",
              6.297
            ],
            [
              "2026-10-13",
              6.33
            ],
            [
              "2026-10-14",
              6.538
            ],
            [
              "2026-10-15",
              6.809
            ],
            [
              "2026-10-16",
              6.731
            ],
            [
              "2026-10-17",
              6.717
            ],
            [
              "2026-10-18",
              6.777
            ],
            [
              "2026-10-19",
              6.792
            ],
            [
              "2026-10-20",
              6.817
            ],
            [
              "2026-10-21",
              6.954
            ],
            [
              "2026-10-22",
              7.178
            ],
            [
              "2026-10-23",
              7.364
            ],
            [
              "2026-10-24",
              7.344
            ],
            [
              "2026-10-25",
              7.438
            ],
            [
              "2026-10-26",
              7.525
            ],
            [
              "2026-10-27",
              7.601
            ],
            [
              "2026-10-28",
              7.673
            ],
            [
              "2026-10-29",
              7.743
            ],
            [
              "2026-10-30",
              7.755
            ],
            [
              "2026-10-31",
              7.84
            ],
            [
              "2026-11-01",
              8.016
            ],
            [
              "2026-11-02",
              8.135
            ],
            [
              "2026-11-03",
              8.153
            ],
            [
              "2026-11-04",
              8.241
            ],
            [
              "2026-11-05",
              8.311
            ],
            [
              "2026-11-06",
              8.425
            ],
            [
              "2026-11-07",
              8.547
            ],
            [
              "2026-11-08",
              8.58
            ],
            [
              "2026-11-09",
              8.658
            ],
            [
              "2026-11-10",
              8.713
            ],
            [
              "2026-11-11",
              8.838
            ],
            [
              "2026-11-12",
              8.852
            ],
            [
              "2026-11-13",
              8.951
            ]
          ]
        },
        {
          "label": "2025",
          "points": [
            [
              "2026-09-01",
              4.746
            ],
            [
              "2026-09-02",
              4.697
            ],
            [
              "2026-09-03",
              4.667
            ],
            [
              "2026-09-04",
              4.677
            ],
            [
              "2026-09-05",
              4.627
            ],
            [
              "2026-09-06",
              4.664
            ],
            [
              "2026-09-07",
              4.624
            ],
            [
              "2026-09-08",
              4.543
            ],
            [
              "2026-09-09",
              4.56
            ],
            [
              "2026-09-10",
              4.618
            ],
            [
              "2026-09-11",
              4.671
            ],
            [
              "2026-09-12",
              4.626
            ],
            [
              "2026-09-13",
              4.693
            ],
            [
              "2026-09-14",
              4.657
            ],
            [
              "2026-09-15",
              4.691
            ],
            [
              "2026-09-16",
              4.69
            ],
            [
              "2026-09-17",
              4.724
            ],
            [
              "2026-09-18",
              4.688
            ],
            [
              "2026-09-19",
              4.768
            ],
            [
              "2026-09-20",
              4.78
            ],
            [
              "2026-09-21",
              4.812
            ],
            [
              "2026-09-22",
              4.825
            ],
            [
              "2026-09-23",
              4.845
            ],
            [
              "2026-09-24",
              4.76
            ],
            [
              "2026-09-25",
              4.817
            ],
            [
              "2026-09-26",
              4.871
            ],
            [
              "2026-09-27",
              4.919
            ],
            [
              "2026-09-28",
              4.991
            ],
            [
              "2026-09-29",
              5.054
            ],
            [
              "2026-09-30",
              5.112
            ],
            [
              "2026-10-01",
              5.26
            ],
            [
              "2026-10-02",
              5.291
            ],
            [
              "2026-10-03",
              5.3
            ],
            [
              "2026-10-04",
              5.485
            ],
            [
              "2026-10-05",
              5.668
            ],
            [
              "2026-10-06",
              5.639
            ],
            [
              "2026-10-07",
              5.695
            ],
            [
              "2026-10-08",
              5.728
            ],
            [
              "2026-10-09",
              5.709
            ],
            [
              "2026-10-10",
              5.803
            ],
            [
              "2026-10-11",
              5.868
            ],
            [
              "2026-10-12",
              5.946
            ],
            [
              "2026-10-13",
              5.963
            ],
            [
              "2026-10-14",
              5.886
            ],
            [
              "2026-10-15",
              5.961
            ],
            [
              "2026-10-16",
              6.06
            ],
            [
              "2026-10-17",
              6.129
            ],
            [
              "2026-10-18",
              6.213
            ],
            [
              "2026-10-19",
              6.272
            ],
            [
              "2026-10-20",
              6.398
            ],
            [
              "2026-10-21",
              6.601
            ],
            [
              "2026-10-22",
              6.705
            ],
            [
              "2026-10-23",
              6.877
            ],
            [
              "2026-10-24",
              7.068
            ],
            [
              "2026-10-25",
              7.202
            ],
            [
              "2026-10-26",
              7.268
            ],
            [
              "2026-10-27",
              7.346
            ],
            [
              "2026-10-28",
              7.487
            ],
            [
              "2026-10-29",
              7.629
            ],
            [
              "2026-10-30",
              7.686
            ],
            [
              "2026-10-31",
              7.676
            ],
            [
              "2026-11-01",
              7.872
            ],
            [
              "2026-11-02",
              7.843
            ],
            [
              "2026-11-03",
              7.845
            ],
            [
              "2026-11-04",
              7.86
            ],
            [
              "2026-11-05",
              7.955
            ],
            [
              "2026-11-06",
              8.105
            ],
            [
              "2026-11-07",
              8.147
            ],
            [
              "2026-11-08",
              8.337
            ],
            [
              "2026-11-09",
              8.363
            ],
            [
              "2026-11-10",
              8.535
            ],
            [
              "2026-11-11",
              8.659
            ],
            [
              "2026-11-12",
              8.728
            ],
            [
              "2026-11-13",
              8.794
            ]
          ]
        },
        {
          "label": "2024",
          "points": [
            [
              "2026-09-01",
              4.325
            ],
            [
              "2026-09-02",
              4.335
            ],
            [
              "2026-09-03",
              4.29
            ],
            [
              "2026-09-04",
              4.286
            ],
            [
              "2026-09-05",
              4.318
            ],
            [
              "2026-09-06",
              4.289
            ],
            [
              "2026-09-07",
              4.247
            ],
            [
              "2026-09-08",
              4.261
            ],
            [
              "2026-09-09",
              4.269
            ],
            [
              "2026-09-10",
              4.245
            ],
            [
              "2026-09-11",
              4.25
            ],
            [
              "2026-09-12",
              4.247
            ],
            [
              "2026-09-13",
              4.251
            ],
            [
              "2026-09-14",
              4.265
            ],
            [
              "2026-09-15",
              4.29
            ],
            [
              "2026-09-16",
              4.289
            ],
            [
              "2026-09-17",
              4.305
            ],
            [
              "2026-09-18",
              4.326
            ],
            [
              "2026-09-19",
              4.301
            ],
            [
              "2026-09-20",
              4.366
            ],
            [
              "2026-09-21",
              4.342
            ],
            [
              "2026-09-22",
              4.405
            ],
            [
              "2026-09-23",
              4.372
            ],
            [
              "2026-09-24",
              4.433
            ],
            [
              "2026-09-25",
              4.503
            ],
            [
              "2026-09-26",
              4.551
            ],
            [
              "2026-09-27",
              4.544
            ],
            [
              "2026-09-28",
              4.558
            ],
            [
              "2026-09-29",
              4.524
            ],
            [
              "2026-09-30",
              4.553
            ],
            [
              "2026-10-01",
              4.72
            ],
            [
              "2026-10-02",
              4.763
            ],
            [
              "2026-10-03",
              4.792
            ],
            [
              "2026-10-04",
              4.865
            ],
            [
              "2026-10-05",
              4.87
            ],
            [
              "2026-10-06",
              4.861
            ],
            [
              "2026-10-07",
              4.923
            ],
            [
              "2026-10-08",
              4.917
            ],
            [
              "2026-10-09",
              4.982
            ],
            [
              "2026-10-10",
              5.085
            ],
            [
              "2026-10-11",
              5.171
            ],
            [
              "2026-10-12",
              5.241
            ],
            [
              "2026-10-13",
              5.263
            ],
            [
              "2026-10-14",
              5.369
            ],
            [
              "2026-10-15",
              5.454
            ],
            [
              "2026-10-16",
              5.576
            ],
            [
              "2026-10-17",
              5.713
            ],
            [
              "2026-10-18",
              5.991
            ],
            [
              "2026-10-19",
              6.2
            ],
            [
              "2026-10-20",
              6.34
            ],
            [
              "2026-10-21",
              6.404
            ],
            [
              "2026-10-22",
              6.557
            ],
            [
              "2026-10-23",
              6.698
            ],
            [
              "2026-10-24",
              7.022
            ],
            [
              "2026-10-25",
              7.175
            ],
            [
              "2026-10-26",
              7.314
            ],
            [
              "2026-10-27",
              7.377
            ],
            [
              "2026-10-28",
              7.409
            ],
            [
              "2026-10-29",
              7.563
            ],
            [
              "2026-10-30",
              7.696
            ],
            [
              "2026-10-31",
              7.637
            ],
            [
              "2026-11-01",
              7.795
            ],
            [
              "2026-11-02",
              7.92
            ],
            [
              "2026-11-03",
              7.981
            ],
            [
              "2026-11-04",
              8.162
            ],
            [
              "2026-11-05",
              8.356
            ],
            [
              "2026-11-06",
              8.478
            ],
            [
              "2026-11-07",
              8.537
            ],
            [
              "2026-11-08",
              8.576
            ],
            [
              "2026-11-09",
              8.658
            ],
            [
              "2026-11-10",
              8.808
            ],
            [
              "2026-11-11",
              8.958
            ],
            [
              "2026-11-12",
              8.981
            ],
            [
              "2026-11-13",
              9.063
            ]
          ]
        },
        {
          "label": "2023",
          "points": [
            [
              "2026-09-01",
              4.527
            ],
            [
              "2026-09-02",
              4.507
            ],
            [
              "2026-09-03",
              4.498
            ],
            [
              "2026-09-04",
              4.469
            ],
            [
              "2026-09-05",
              4.45
            ],
            [
              "2026-09-06",
              4.428
            ],
            [
              "2026-09-07",
              4.441
            ],
            [
              "2026-09-08",
              4.463
            ],
            [
              "2026-09-09",
              4.324
            ],
            [
              "2026-09-10",
              4.339
            ],
            [
              "2026-09-11",
              4.258
            ],
            [
              "2026-09-12",
              4.291
            ],
            [
              "2026-09-13",
              4.256
            ],
            [
              "2026-09-14",
              4.275
            ],
            [
              "2026-09-15",
              4.255
            ],
            [
              "2026-09-16",
              4.266
            ],
            [
              "2026-09-17",
              4.244
            ],
            [
              "2026-09-18",
              4.267
            ],
            [
              "2026-09-19",
              4.253
            ],
            [
              "2026-09-20",
              4.258
            ],
            [
              "2026-09-21",
              4.313
            ],
            [
              "2026-09-22",
              4.313
            ],
            [
              "2026-09-23",
              4.352
            ],
            [
              "2026-09-24",
              4.416
            ],
            [
              "2026-09-25",
              4.436
            ],
            [
              "2026-09-26",
              4.51
            ],
            [
              "2026-09-27",
              4.463
            ],
            [
              "2026-09-28",
              4.483
            ],
            [
              "2026-09-29",
              4.508
            ],
            [
              "2026-09-30",
              4.551
            ],
            [
              "2026-10-01",
              4.755
            ],
            [
              "2026-10-02",
              4.857
            ],
            [
              "2026-10-03",
              4.97
            ],
            [
              "2026-10-04",
              4.969
            ],
            [
              "2026-10-05",
              5.087
            ],
            [
              "2026-10-06",
              5.108
            ],
            [
              "2026-10-07",
              5.168
            ],
            [
              "2026-10-08",
              5.296
            ],
            [
              "2026-10-09",
              5.398
            ],
            [
              "2026-10-10",
              5.539
            ],
            [
              "2026-10-11",
              5.599
            ],
            [
              "2026-10-12",
              5.709
            ],
            [
              "2026-10-13",
              5.744
            ],
            [
              "2026-10-14",
              5.775
            ],
            [
              "2026-10-15",
              5.935
            ],
            [
              "2026-10-16",
              6.093
            ],
            [
              "2026-10-17",
              6.34
            ],
            [
              "2026-10-18",
              6.639
            ],
            [
              "2026-10-19",
              6.895
            ],
            [
              "2026-10-20",
              7.094
            ],
            [
              "2026-10-21",
              7.204
            ],
            [
              "2026-10-22",
              7.289
            ],
            [
              "2026-10-23",
              7.393
            ],
            [
              "2026-10-24",
              7.447
            ],
            [
              "2026-10-25",
              7.603
            ],
            [
              "2026-10-26",
              7.774
            ],
            [
              "2026-10-27",
              7.931
            ],
            [
              "2026-10-28",
              8.09
            ],
            [
              "2026-10-29",
              8.216
            ],
            [
              "2026-10-30",
              8.385
            ],
            [
              "2026-10-31",
              8.478
            ],
            [
              "2026-11-01",
              8.635
            ],
            [
              "2026-11-02",
              8.731
            ],
            [
              "2026-11-03",
              8.773
            ],
            [
              "2026-11-04",
              8.863
            ],
            [
              "2026-11-05",
              8.915
            ],
            [
              "2026-11-06",
              8.987
            ],
            [
              "2026-11-07",
              9.049
            ],
            [
              "2026-11-08",
              9.152
            ],
            [
              "2026-11-09",
              9.334
            ],
            [
              "2026-11-10",
              9.398
            ],
            [
              "2026-11-11",
              9.491
            ],
            [
              "2026-11-12",
              9.609
            ],
            [
              "2026-11-13",
              9.535
            ]
          ]
        }
      ],
      "question": "How big will Arctic sea ice get at its winter peak (Dec 18 to Apr 1)?"
    }
  ],
  "calibration": {
    "ran": "2026-11-14T23:04:50+00:00",
    "temp": {
      "inflate": 1.1,
      "isotonic_blocks": 21,
      "cases": 2016,
      "logloss_raw": 0.2925,
      "logloss": 0.2819,
      "brier": 0.0905,
      "brier_raw": 0.095,
      "calibration_raw": [
        {
          "range": "0.00-0.05",
          "n": 775,
          "predicted": 0.009,
          "actual": 0.006
        },
        {
          "range": "0.05-0.30",
          "n": 497,
          "predicted": 0.155,
          "actual": 0.131
        },
        {
          "range": "0.30-0.70",
          "n": 411,
          "predicted": 0.473,
          "actual": 0.355
        },
        {
          "range": "0.70-0.95",
          "n": 168,
          "predicted": 0.835,
          "actual": 0.744
        },
        {
          "range": "0.95-1.00",
          "n": 165,
          "predicted": 0.99,
          "actual": 0.988
        }
      ],
      "calibration": [
        {
          "range": "0.00-0.05",
          "n": 839,
          "predicted": 0.009,
          "actual": 0.007
        },
        {
          "range": "0.05-0.30",
          "n": 523,
          "predicted": 0.166,
          "actual": 0.163
        },
        {
          "range": "0.30-0.70",
          "n": 395,
          "predicted": 0.437,
          "actual": 0.441
        },
        {
          "range": "0.70-0.95",
          "n": 98,
          "predicted": 0.799,
          "actual": 0.816
        },
        {
          "range": "0.95-1.00",
          "n": 161,
          "predicted": 0.989,
          "actual": 0.988
        }
      ],
      "base_rate": 0.25
    },
    "ice": {
      "kernel": 0.12,
      "reg_inflate": 1.2,
      "regression": {
        "cases": 440,
        "logloss": 0.4651,
        "brier": 0.1568,
        "calibration": [
          {
            "range": "0.00-0.05",
            "n": 40,
            "predicted": 0.037,
            "actual": 0
          },
          {
            "range": "0.05-0.30",
            "n": 120,
            "predicted": 0.184,
            "actual": 0.25
          },
          {
            "range": "0.30-0.70",
            "n": 120,
            "predicted": 0.501,
            "actual": 0.525
          },
          {
            "range": "0.70-0.95",
            "n": 120,
            "predicted": 0.817,
            "actual": 0.808
          },
          {
            "range": "0.95-1.00",
            "n": 40,
            "predicted": 0.963,
            "actual": 1
          }
        ]
      },
      "analog": {
        "cases": 338,
        "logloss": 0.3372,
        "brier": 0.1098,
        "calibration": [
          {
            "range": "0.00-0.05",
            "n": 85,
            "predicted": 0.007,
            "actual": 0.012
          },
          {
            "range": "0.05-0.30",
            "n": 80,
            "predicted": 0.134,
            "actual": 0.15
          },
          {
            "range": "0.30-0.70",
            "n": 79,
            "predicted": 0.468,
            "actual": 0.544
          },
          {
            "range": "0.70-0.95",
            "n": 61,
            "predicted": 0.834,
            "actual": 0.852
          },
          {
            "range": "0.95-1.00",
            "n": 33,
            "predicted": 0.976,
            "actual": 1
          }
        ]
      }
    }
  },
  "sites": [
    {
      "id": "nuai-tcdc",
      "name": "New Era Energy & Digital (NUAI): Texas Critical Data Centers",
      "promise": "Firm power Q3 2027; initial ready-for-service Q4 2027 (guided 2026-11-12)",
      "watch_for": "Building shells, substation and paved pads appearing on the graded rectangle. Still bare dirt by mid-2027 = the Q4 2027 date is unlikely.",
      "located": true,
      "ticker": "NUAI",
      "points": [
        {
          "day": "2025-11-02",
          "ndvi": 0.1797,
          "bright": 2416.1
        },
        {
          "day": "2026-11-12",
          "ndvi": 0.1271,
          "bright": 2320.6
        }
      ],
      "baseline": "2025-11-02",
      "latest": "2026-11-12",
      "vsDay": "2025-11-02",
      "ndviChange": -0.053,
      "brightChange": -0.04,
      "verdict": "Changing: new ground or structures since 2025-11-02",
      "photoBaseline": "https://planetarycomputer.microsoft.com/api/data/v1/item/bbox/-102.34,31.8,-102.27000000000001,31.87.png?collection=sentinel-2-l2a&item=S2B_MSIL2A_20251102T172359_R012_T13SGR_20251102T211445&assets=visual&asset_bidx=visual%7C1%2C2%2C3&nodata=0&max_size=800",
      "photoLatest": "https://planetarycomputer.microsoft.com/api/data/v1/item/bbox/-102.34,31.8,-102.27000000000001,31.87.png?collection=sentinel-2-l2a&item=S2C_MSIL2A_20261112T172551_R012_T13SGR_20261112T204847&assets=visual&asset_bidx=visual%7C1%2C2%2C3&nodata=0&max_size=800"
    },
    {
      "id": "lvg-imwelo",
      "name": "Lake Victoria Gold (LVG): Imwelo",
      "promise": "CEO targeted first production around mid-2027 (2026-06-30); early earthworks only, no formal construction decision",
      "watch_for": "A pit, plant pad and tailings dam taking shape. Still mostly dirt and scrub by early 2027 = mid-2027 is unrealistic.",
      "located": false,
      "note": "NOT FOUND yet. Near Katoro / Imwelo village, Geita Region, Tanzania (around -3.0, 31.9). Needs a sourced location."
    }
  ],
  "notes": [
    "ERA5 through 2026-11-12",
    "NSIDC through 2026-11-13"
  ],
  "ideas": [
    {
      "name": "Global temperature records (monthly)",
      "status": "live",
      "cadence": "3 checks a day, new market every month",
      "why": "Kalshi 'hottest month ever' (settles on NOAA) and Polymarket monthly brackets (NASA). ERA5's daily global reading, built largely from satellites, shows most of the month before NOAA or NASA publish. Backtest: 2,016 cases since 2005, calibrated.",
      "data": "Copernicus ERA5 daily, NOAA NCEI and NASA GISS monthly"
    },
    {
      "name": "Hottest year (NASA)",
      "status": "live",
      "cadence": "3 checks a day until January",
      "why": "Kalshi asks if 2026 beats 2025 and 1.28 C on NASA's index. Ten months are published; the desk forecasts November and December from ERA5.",
      "data": "NASA GISS monthly, ERA5 daily"
    },
    {
      "name": "Arctic sea ice maximum",
      "status": "live",
      "cadence": "3 checks a day until April 1",
      "why": "Kalshi levels for the winter max, settled on NSIDC's daily satellite extent. Before the window opens a regression on today's extent wins (low starts catch up); after it opens, past seasons' growth is used.",
      "data": "NSIDC Sea Ice Index v4 daily"
    },
    {
      "name": "Construction site watch",
      "status": "live",
      "cadence": "a new photo about every 10 days",
      "why": "Is anything actually being built where a company says it is? The backtest showed photos do not predict late finishes, so this only flags empty sites. No trades.",
      "data": "Sentinel-2, 10 m, Planetary Computer"
    },
    {
      "name": "Same-day high temperature from live cloud images",
      "status": "next",
      "cadence": "every day, 15 cities, the most frequent idea here",
      "why": "Weather-desk's own research found cloud and model spread predict how big the same-day miss is. GOES weather satellites image the US every 5 to 10 minutes: a morning cloud deck that the models missed should move the 3pm high. Feed the observed cloud over each settlement station into weather-desk's same-day bets.",
      "data": "GOES-East/West via NASA GIBS (free)"
    },
    {
      "name": "Arctic sea ice minimum",
      "status": "next season",
      "cadence": "daily from about June 2027",
      "why": "Same machinery as the max, for Kalshi's September minimum markets.",
      "data": "NSIDC daily"
    },
    {
      "name": "Hurricane counts from ocean temperature",
      "status": "spring 2027",
      "cadence": "weekly from May, daily in season",
      "why": "Kalshi lists 60+ hurricane series (counts, majors, landfalls). Season counts move with sea surface temperature in the Atlantic hurricane belt, measured daily by satellite. Long-dated count markets update slowly; landfall markets are crowded with NHC watchers, so skip those.",
      "data": "NOAA OISST daily sea surface temperature, NHC"
    },
    {
      "name": "Wildfires near utility lines",
      "status": "idea, needs a backtest",
      "cadence": "every few hours when fires are burning",
      "why": "NASA FIRMS flags active fires within about 3 hours. A large fire growing next to a utility's lines (PG&E, Edison, Xcel, Hawaiian Electric) has moved those stocks for days. Paper short only; the risk is that news beats the satellite.",
      "data": "NASA FIRMS VIIRS/MODIS"
    },
    {
      "name": "Power outages from night lights",
      "status": "later",
      "cadence": "daily after big storms",
      "why": "VIIRS night-light images show which towns stay dark after a storm, before utilities publish restore times. Useful for utility and insurer moves; no prediction market settles on it today.",
      "data": "NASA Black Marble daily"
    },
    {
      "name": "China factory activity from air quality",
      "status": "idea, crowded",
      "cadence": "daily",
      "why": "Sentinel-5P nitrogen dioxide over Chinese industrial cities tracks factory output ahead of official data. Funds already buy this, so expect little edge.",
      "data": "Sentinel-5P TROPOMI"
    },
    {
      "name": "Snowfall markets",
      "status": "tested, weak",
      "cadence": "monthly",
      "why": "Kalshi has 40+ snow series, but they settle on a station's measured snowfall. Satellites see snow on the ground, not how much fell at one gauge, so radar and models beat them.",
      "data": "MODIS snow cover"
    }
  ]
};

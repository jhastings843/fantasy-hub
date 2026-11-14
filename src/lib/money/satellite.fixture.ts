import type { Satellite } from "./types";

// A real site-watch data/status.json (2026-11-14), the exact shape trade-bot passes through as snapshot.satellite.
// The type annotation makes tsc check it against the Satellite type.
export const satelliteFixture: Satellite = {
  "version": 1,
  "generatedAt": "2026-11-14T23:07:28+00:00",
  "bankroll": 1000.0,
  "cash": 911.95,
  "equity": 981.8,
  "realizedPnl": 0,
  "fees": 3.99,
  "openCost": 84.06,
  "settled": 0,
  "wins": 0,
  "curve": [
    {
      "day": "2026-11-14",
      "equity": 981.8
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
      "yesBid": 0.89,
      "yesAsk": 0.9,
      "best": {
        "side": "no",
        "ask": 0.11,
        "edge": 0.0713
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
      "yesAsk": 0.95,
      "best": {
        "side": "yes",
        "ask": 0.95,
        "edge": 0.0179
      },
      "action": "edge +1.8c under 5c",
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
      "yesBid": 0.902,
      "yesAsk": 0.915,
      "best": {
        "side": "yes",
        "ask": 0.915,
        "edge": 0.0508
      },
      "action": "bet",
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
      "yesAsk": 0.03,
      "best": {
        "side": "yes",
        "ask": 0.03,
        "edge": 0.0237
      },
      "action": "edge +2.4c under 5c",
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
      "yesBid": 0.08,
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
      "yesBid": 0.7,
      "yesAsk": 0.75,
      "best": {
        "side": "no",
        "ask": 0.3,
        "edge": 0.0107
      },
      "action": "edge +1.1c under 5c",
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

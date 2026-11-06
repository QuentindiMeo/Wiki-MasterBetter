#!/usr/bin/env python3
"""
Scoring d'opportunités d'achat : combine le montant de l'achat et la décote
par rapport au prix de marché.

Modèle
------
    score_brut = (prix / prix_ref) ** alpha  *  (1 / ratio) ** beta

avec ratio = prix / valeur_marché  (0.5 = acheté à 50 % du marché).

En logarithme c'est une simple combinaison linéaire :

    ln(score) = alpha * ln(prix/prix_ref)  +  beta * ln(1/ratio)

ce qui rend l'arbitrage explicite :
  * doubler le prix       multiplie le score par 2**alpha
  * diviser le ratio par 2 (décote deux fois meilleure) le multiplie par 2**beta
  * alpha / beta = combien de doublements de prix valent un doublement de décote

alpha et beta ne sont pas devinés : `calibrate()` les déduit de tes propres
préférences exprimées sous forme « A doit scorer N fois B ».
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

PRICE_REF = 100.0  # unité de prix, n'affecte que l'échelle des scores bruts


# --------------------------------------------------------------------------- modèle
@dataclass(frozen=True, slots=True)
class Buy:
    label: str
    price: float            # ce que tu paies
    market: float           # valeur de marché estimée

    def __post_init__(self):
        if self.price <= 0 or self.market <= 0:
            raise ValueError(f"{self.label}: prix et marché doivent être > 0")

    @property
    def ratio(self) -> float:
        """prix / marché. 0.5 = payé la moitié du marché."""
        return self.price / self.market

    @property
    def discount(self) -> float:
        """Décote en fraction. 0.5 = 50 % sous le marché."""
        return 1.0 - self.ratio

    @property
    def savings(self) -> float:
        """Gain absolu en monnaie."""
        return self.market - self.price


def raw_score(buy: Buy, alpha: float, beta: float,
              price_cap: float | None = None) -> float:
    """Score brut, non borné. 0 si l'achat est au-dessus du marché.

    price_cap : saturation douce du terme de taille. Au-delà de ce prix, la
    contribution du montant croît en racine plutôt qu'en puissance alpha, ce
    qui évite qu'un très gros achat écrase tout le classement.
    """
    r = buy.ratio
    if r >= 1.0:
        return 0.0

    p = buy.price
    if price_cap is not None and p > price_cap:
        # continuité en p = price_cap, puis croissance en sqrt
        p = price_cap * math.sqrt(p / price_cap)

    return (p / PRICE_REF) ** alpha * (1.0 / r) ** beta


def score_all(buys, alpha: float, beta: float, price_cap=None):
    """-> [(buy, score_brut, score_0_100)] trié par score décroissant.

    Le score 0-100 est une mise à l'échelle *logarithmique* : les scores bruts
    s'étalent sur plusieurs ordres de grandeur, une normalisation linéaire
    écraserait tout le bas du classement contre zéro.
    """
    rows = [(b, raw_score(b, alpha, beta, price_cap)) for b in buys]
    pos = [s for _, s in rows if s > 0]
    if not pos:
        return [(b, s, 0.0) for b, s in rows]

    lo, hi = math.log(min(pos)), math.log(max(pos))
    span = hi - lo

    def to100(s):
        if s <= 0:
            return 0.0
        return 100.0 if span == 0 else 100.0 * (math.log(s) - lo) / span

    out = [(b, s, to100(s)) for b, s in rows]
    out.sort(key=lambda t: -t[1])
    return out


# ----------------------------------------------------------------------- calibration
def calibrate(constraints) -> tuple[float, float]:
    """Déduit (alpha, beta) de préférences « better doit scorer `times` fois worse ».

    constraints : liste de (better: Buy, worse: Buy, times: float)

    Chaque contrainte donne une équation linéaire en (alpha, beta) :
        alpha * ln(p_b / p_w) + beta * ln(r_w / r_b) = ln(times)

    Deux contraintes suffisent ; au-delà, résolution aux moindres carrés.
    """
    A, y = [], []
    for better, worse, times in constraints:
        if times <= 0:
            raise ValueError("`times` doit être > 0")
        A.append([math.log(better.price / worse.price),
                  math.log(worse.ratio / better.ratio)])
        y.append(math.log(times))

    sol, *_ = np.linalg.lstsq(np.array(A), np.array(y), rcond=None)
    alpha, beta = float(sol[0]), float(sol[1])

    if alpha <= 0 or beta <= 0:
        raise ValueError(
            f"calibration incohérente (alpha={alpha:.3f}, beta={beta:.3f}) : "
            "tes contraintes impliquent qu'un prix plus élevé ou une décote "
            "meilleure fait *baisser* le score. Revois les rapports demandés.")
    return alpha, beta


def explain(buy: Buy, alpha: float, beta: float) -> str:
    """Décompose la contribution de chaque terme, en log."""
    size = alpha * math.log(buy.price / PRICE_REF)
    deal = beta * math.log(1.0 / buy.ratio) if buy.ratio < 1 else float("-inf")
    tot = size + deal
    share = 100 * size / tot if tot else 0.0
    return (f"{buy.label:<22} prix {buy.price:>8.2f}  marché {buy.market:>9.2f}  "
            f"ratio {buy.ratio:>5.0%}  décote {buy.discount:>5.0%}  "
            f"économie {buy.savings:>8.2f}  |  taille {size:+.2f} "
            f"décote {deal:+.2f}  ({share:.0f} % taille)")


# ----------------------------------------------------------------------------- démo
if __name__ == "__main__":
    A = Buy("A  500 @ 90 %", price=500,  market=500 / 0.90)
    B = Buy("B 1200 @ 50 %", price=1200, market=1200 / 0.50)
    C = Buy("C  300 @ 80 %", price=300,  market=300 / 0.80)

    # Tes préférences : B >> A >> C. On les chiffre.
    alpha, beta = calibrate([(B, A, 7.0),    # B doit scorer ~7x A
                             (A, C, 1.9)])   # A doit scorer ~1.9x C
    print(f"calibration -> alpha = {alpha:.3f}   beta = {beta:.3f}")
    print(f"arbitrage   : un doublement de prix vaut "
          f"{alpha/beta:.2f} doublement(s) de décote\n")

    pool = [A, B, C,
            Buy("D   80 @ 35 %", price=80,   market=80 / 0.35),
            Buy("E 3000 @ 75 %", price=3000, market=3000 / 0.75),
            Buy("F  450 @ 60 %", price=450,  market=450 / 0.60),
            Buy("G  900 @ 105 %", price=900, market=900 / 1.05)]

    print(f"{'#':<3}{'achat':<22}{'score':>10}{'/100':>8}")
    for i, (b, raw, pct) in enumerate(score_all(pool, alpha, beta), 1):
        print(f"{i:<3}{b.label:<22}{raw:>10.1f}{pct:>8.1f}")

    print()
    for b in (B, A, C):
        print(explain(b, alpha, beta))

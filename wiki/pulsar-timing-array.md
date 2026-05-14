# Pulsar Timing Array

**Summary**: A galaxy-scale detector composed of a network of highly stable millisecond pulsars used to detect low-frequency gravitational waves.

**Sources**: [[s41550-019-0880-2 (1).pdf]], [[stac3719.pdf]], [[tempo2_manual.pdf]]

**Last updated**: 2026-04-27

---

A Pulsar Timing Array (PTA) is a collaborative effort to monitor a large number of [[millisecond-pulsar]]s over decades. The goal is to detect the tiny, correlated perturbations in pulse arrival times caused by the passage of gravitational waves (source: s41550-019-0880-2 (1).pdf).

## Detection Principle
When a gravitational wave passes between a pulsar and Earth, it stretches and squeezes spacetime. This causes the pulses to arrive slightly earlier or later than predicted by the [[pulsar-timing]] model.
- **The Hellings-Downs Curve**: This is the characteristic "quadrupolar" correlation pattern expected in the residuals of pairs of pulsars across the sky. Detecting this pattern is the "smoking gun" for a gravitational wave background.

## Targets: Supermassive Black Hole Binaries
Unlike LIGO, which detects high-frequency waves from stellar-mass black holes, PTAs are sensitive to nanohertz-frequency waves. These are primarily produced by pairs of supermassive black holes (billions of solar masses) in the centers of merging galaxies (source: s41550-019-0880-2 (1).pdf).

## Key PTA Collaborations
- **NANOGrav**: North American Nanohertz Observatory for Gravitational Waves.
- **EPTA**: European Pulsar Timing Array.
- **PPTA**: Parkes Pulsar Timing Array.
- **MPTA**: MeerKAT Pulsar Timing Array (source: [[meerkat]], stac3719.pdf).

## Software Requirements
PTAs require sub-microsecond timing precision. Tools like [[tempo2]] are essential for removing all other sources of noise (like Solar System ephemeris errors or ISM variations) to reveal the gravitational wave signal (source: tempo2_manual.pdf).

## Related pages

- [[pulsar-timing]]
- [[millisecond-pulsar]]
- [[tempo2]]
- [[meerkat]]
- [[psr-j0740+6620]]

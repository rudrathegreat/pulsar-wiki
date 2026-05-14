# Pulsar Timing

**Summary**: The high-precision technique of accounting for every single rotation of a pulsar over long time periods to build a comprehensive model of its physics and environment.

**Sources**: [[tempo2_manual.pdf]], [[pulsars.md]], [[stac3719.pdf]]

**Last updated**: 2026-04-27

---

Pulsar timing is the process of comparing the observed pulse times of arrival (TOAs) with a predictive model. It is the primary tool for precision pulsar astronomy and tests of fundamental physics (source: tempo2_manual.pdf).

## The Timing Model
The model accounts for all physical effects that influence the arrival time of a pulse, including:
- **Astrometry**: Position (RA, Dec), Proper Motion, and Parallax.
- **Spin Dynamics**: Spin frequency ($\nu$), spin-down rate ($\dot{\nu}$), and glitches.
- **Interstellar Medium**: [[dispersion-measure]] (DM) and its temporal variations.
- **Binary Motion**: Orbital parameters for pulsars in systems (source: stac3719.pdf).

## The Timing Equation
The fundamental goal is to relate the observed time of arrival at the observatory ($t_{obs}$) to the time of emission in the pulsar's frame ($T$):
\[ \Delta t = (t_{obs} - t_0) + \Delta_{clock} + \Delta_{Roemer} + \Delta_{Shapiro} + \Delta_{Einstein} + \Delta_{DM} \]
Where:
- **$\Delta_{clock}$**: Corrections for observatory clock offsets and terrestrial time scales.
- **$\Delta_{Roemer}$**: The geometric delay due to the Earth's position in its orbit.
- **$\Delta_{Shapiro}$**: Relativistic delay due to the curvature of spacetime near a companion (source: [[shapiro-delay]]).
- **$\Delta_{Einstein}$**: Time dilation due to the pulsar's motion and the gravitational field of companions.
- **$\Delta_{DM}$**: Frequency-dependent delay due to the interstellar medium (source: [[dispersion-measure]]).

## Residual Analysis
The difference between the observed TOA and the model's prediction is the **Timing Residual**.
- **White Noise**: Radiometer noise and jitter.
- **Red Noise**: Long-term correlated noise, often caused by rotational instabilities or gravitational waves.
- **DM Noise**: Variations in the electron density of the ISM (source: stac3719.pdf).

## Tools of the Trade
Timing analysis is primarily performed using the [[tempo2]] software package, which implements these physical models with relativistic precision (source: tempo2_manual.pdf).

## Related pages

- [[pulsar]]
- [[tempo2]]
- [[shapiro-delay]]
- [[dispersion-measure]]
- [[binary-pulsar]]
- [[meerkat]]

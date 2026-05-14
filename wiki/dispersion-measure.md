# Dispersion Measure

**Summary**: The integrated column density of free electrons between a pulsar and Earth, causing a frequency-dependent delay in pulse arrival times.

**Sources**: [[pulsars.md]], [[pulsar-info.txt]], [[stac3719.pdf]]

**Last updated**: 2026-04-27

---

The interstellar medium (ISM) is not a vacuum but contains free electrons. These electrons affect the propagation of radio waves, a phenomenon known as dispersion.

## Physical Mechanism
The velocity of a radio wave in a plasma depends on its frequency. Higher-frequency waves travel faster than lower-frequency waves. The time delay ($\Delta t$) between two frequencies $f_1$ and $f_2$ is given by:
\[ \Delta t \approx 4.15 \times 10^3 \text{ ms} \times \left( f_1^{-2} - f_2^{-2} \right) \times \text{DM} \]
Where $f$ is in MHz and DM is in units of pc cm\(^{-3}\) (source: pulsars.md).

## Measurement and Significance
- **Distance Estimation**: By assuming a model for the distribution of electrons in the Galaxy (e.g., NE2001 or YMW16), the measured DM can be used to estimate the pulsar's distance.
- **ISM Probe**: Temporal variations in DM (monitored by tools like [[tempo2]]) provide insights into the turbulent structure of the interstellar medium.
- **De-dispersion**: To recover the sharp pulse profile, observers must "de-disperse" the data, shifting the arrival times of different frequency channels to line up at a common reference frequency (source: stac3719.pdf).

## Catalog Examples
- **Low DM**: **J0006+1834** (DM = 11.41 pc cm\(^{-3}\)) indicates a nearby pulsar (source: pulsar-info.txt).
- **High DM**: **J0002+6216** (DM = 218.6 pc cm\(^{-3}\)) indicates a distant pulsar or one located behind a dense electron region.

## Related pages

- [[pulsar]]
- [[pulsar-timing]]
- [[radio-pulsar]]
- [[meerkat]]

# Shapiro Delay

**Summary**: A post-Keplerian relativistic effect where pulse arrival times are delayed as signals pass through the curved spacetime of a companion star.

**Sources**: [[s41550-019-0880-2 (1).pdf]], [[stac3719.pdf]], [[tempo2_manual.pdf]]

**Last updated**: 2026-04-27

---

The Shapiro delay is a critical relativistic effect in [[pulsar-timing]]. It occurs at superior conjunction, when the pulsar is behind its companion relative to the observer (source: s41550-019-0880-2 (1).pdf).

## Traditional Parameters ($r$ and $s$)
In general relativity, the delay ($\Delta_S$) is parameterized by:
- **Range ($r$)**: Directly proportional to the companion mass ($m_c$).
- **Shape ($s$)**: Defined as $\sin(i)$, where $i$ is the orbital inclination.
\[ \Delta_S(\Phi) = -2r \ln(1 - s \sin\Phi) \]
Where $\Phi$ is the orbital phase (source: stac3719.pdf).

## Orthometric Parameters ($h_3$ and $\varsigma$)
In systems with low to moderate orbital inclination, $r$ and $s$ are highly correlated, leading to large uncertainties in the individual masses. Modern analyses use the **Orthometric Parameterization**:
- **$h_3$**: The third harmonic of the orbital period in the timing residuals.
- **$\varsigma$ (zeta)**: A parameter describing the ratio of harmonics.
These parameters allow for a more stable and accurate extraction of the companion mass ($m_c$) and inclination ($i$) from the timing data (source: stac3719.pdf).

## Scientific Applications
1. **Pulsar Mass Measurement**: By measuring $r$ and $s$, and combining them with the binary mass function, the mass of the pulsar ($m_p$) can be uniquely determined.
2. **Testing General Relativity**: If more than two post-Keplerian parameters (e.g., Shapiro delay and periastron advance) are measured, they can be used to test the self-consistency of GR.
3. **Equation of State (EoS)**: High-mass measurements made via Shapiro delay, such as the $2.14 M_{\odot}$ for [[psr-j0740+6620]], are essential for constraining the internal physics of [[neutron-star]]s (source: s41550-019-0880-2 (1).pdf).

## Related pages

- [[pulsar-timing]]
- [[binary-pulsar]]
- [[psr-j0740+6620]]
- [[neutron-star]]
- [[meerkat]]

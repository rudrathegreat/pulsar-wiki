# Astrometry

**Summary**: The branch of astronomy dealing with the precise measurement of the positions and movements of celestial bodies.

**Sources**: [[pulsar-timing.md]], [[tempo2_manual.pdf]]

**Last updated**: 2026-04-27

---

In pulsar science, astrometry is achieved through [[pulsar-timing]]. Because timing is so precise, it can measure the position of a pulsar to within milliarcseconds (source: tempo2_manual.pdf).

## Key Parameters
- **Position (RA, Dec)**: The pulsar's coordinates on the sky.
- **Proper Motion ($\mu$)**: The transverse velocity of the pulsar across the sky, usually measured in milliarcseconds per year (mas/yr).
- **Parallax ($\pi$)**: The apparent shift in position as the Earth orbits the Sun, used to calculate the distance to the pulsar independently of [[dispersion-measure]].

## Geometric Delays
Astrometric effects introduce specific delays in the timing model:
- **Roemer Delay**: The light-travel time across the Earth's orbit. This is the largest correction in the [[pulsar-timing]] model (source: tempo2_manual.pdf).

## Kick Velocities
Astrometric measurements show that many pulsars have high transverse velocities (hundreds of km/s). This is likely due to "asymmetric kicks" received during the supernova explosion that created the [[neutron-star]].

## Related pages

- [[pulsar-timing]]
- [[tempo2]]
- [[neutron-star]]
- [[dispersion-measure]]

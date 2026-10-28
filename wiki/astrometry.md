# Astrometry

**Summary**: The branch of astronomy dealing with the precise measurement of the positions and movements of celestial bodies.

**Sources**: [[pulsar-timing]], [tempo2_manual.pdf](/#file/tempo2_manual.pdf), [1011.0718.pdf](/#file/1011.0718.pdf)

**Last updated**: 2026-10-23

---

In pulsar science, astrometry is achieved through [[pulsar-timing]]. Because timing is so precise, it can measure the position of a pulsar to within milliarcseconds (source: [tempo2_manual.pdf](/#file/tempo2_manual.pdf)).

## Key Parameters
- **Position (RA, Dec)**: The pulsar's coordinates on the sky.
- **Proper Motion ($\mu$)**: The transverse velocity of the pulsar across the sky, usually measured in milliarcseconds per year (mas/yr).
- **Parallax ($\pi$)**: The apparent shift in position as the Earth orbits the Sun, used to calculate the distance to the pulsar independently of [[dispersion-measure]].

For PSR B1913+16, the paper reports the proper motion components \(\mu_\alpha=-1.43\pm0.13\) and \(\mu_\delta=-0.70\pm0.13\) mas yr\(^{-1}\). These measurements contribute to the system's transverse-velocity and Galactic-acceleration corrections (source: [1011.0718.pdf](/#file/1011.0718.pdf)).

## Geometric Delays
Astrometric effects introduce specific delays in the timing model:
- **Roemer Delay**: The light-travel time across the Earth's orbit. This is the largest correction in the [[pulsar-timing]] model (source: [tempo2_manual.pdf](/#file/tempo2_manual.pdf)).

## Kick Velocities

Astrometric measurements show that many pulsars have high transverse velocities (hundreds of km/s). This is likely due to "asymmetric kicks" received during the supernova explosion that created the [[neutron-star]].

## Related pages

- [[pulsar-timing]]
- [[tempo2]]
- [[psr-b1913-16]]
- [[systemic-velocity]]
- [[neutron-star]]
- [[dispersion-measure]]
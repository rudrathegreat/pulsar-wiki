# Radio Telescope

**Summary**: Large-scale astronomical instruments used to detect the faint radio emission from pulsars across a wide range of frequencies.

**Sources**: [[pulsars.md]], [[stac3719.pdf]], [[s41550-019-0880-2 (1).pdf]]

**Last updated**: 2026-04-27

---

Pulsars are extremely faint radio sources, requiring some of the world's largest and most sensitive scientific instruments to detect (source: pulsars.md).

## Major Pulsar Observatories
- **Green Bank Telescope (GBT)**: A 100-meter fully steerable single-dish telescope in West Virginia, USA. It was used for the high-precision timing of [[psr-j0740+6620]] (source: s41550-019-0880-2 (1).pdf).
- **[[meerkat]]**: A 64-dish interferometer in South Africa, providing exceptional sensitivity in the Southern Hemisphere (source: stac3719.pdf).
- **Parkes (Murriyang)**: A 64-meter dish in Australia with a long history of pulsar discovery, including the first [[millisecond-pulsar]] found in a globular cluster.
- **Arecibo Observatory**: (Historical) A 305-meter fixed-dish telescope in Puerto Rico, formerly the world's most sensitive pulsar detector.

## Operating Principles
- **Receiver Sensitivity**: Measured in terms of System Temperature ($T_{sys}$). Lower temperatures mean less noise and the ability to detect fainter pulses.
- **Bandwidth**: The range of frequencies detected simultaneously. Larger bandwidths allow for more sensitive detections and better [[dispersion-measure]] calculations (source: stac3719.pdf).
- **Data Processing Pipeline**: Modern radio telescopes generate massive amounts of data. Specialized software libraries are required to process this data:
    - **[[psrchive]]**: For profile analysis and calibration.
    - **SIGPROC/PRESTO**: Used for searching for new pulsars.
    - **DSPSR**: Enables real-time coherent de-dispersion (source: psrchive.pdf).

## Related pages

- [[meerkat]]
- [[pulsar]]
- [[pulsar-timing]]
- [[dispersion-measure]]
- [[psr-j0740+6620]]

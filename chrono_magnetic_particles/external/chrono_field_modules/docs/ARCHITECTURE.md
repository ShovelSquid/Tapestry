# Architecture

`text intent -> validated command/shape goal -> optimizer or learned policy -> frequency/phase programs -> field solver -> rigid/particle response -> score -> log`

Keep three layers distinct:

1. **Intent:** language model chooses topology and goals.
2. **Control:** deterministic optimizer or neural policy chooses bounded actuator signals.
3. **Physics:** solver alone decides what actually happens.

The visual particle buffer must not be treated as the field. The vector field exists analytically or on a grid; particles merely sample or physically respond to it depending on their type.

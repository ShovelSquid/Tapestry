#pragma once
#include "math.hpp"
#include <cstdint>
#include <string>
#include <vector>
namespace living_field {
struct SpinProgram { Vec3 axis{0,0,1}; double frequency_hz{}; double phase_rad{}; double amplitude{1}; double frequency_rate_hz_per_s{}; };
struct MagneticNode { std::uint32_t id{}; Vec3 position{},velocity{}; Vec3 magnetic_axis{0,0,1}; Vec3 angular_velocity{}; double radius{0.05}; double mass{1}; double dipole_moment{1}; SpinProgram drive{}; bool externally_driven{true}; };
struct ForceTorque { Vec3 force{},torque{}; };
struct FieldSample { Vec3 position{},B{}; };
struct ResponsiveParticle { Vec3 position{},velocity{},moment_axis{0,0,1}; double mass{0.001}; double radius{0.001}; double susceptibility{1}; double dipole_moment{0.001}; double drag{0.2}; };
struct ShapeGoal { std::string name{"unnamed"}; std::vector<Vec3> sample_points; std::vector<double> target_density; };
}

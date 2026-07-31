#pragma once
#include "dipole_field.hpp"
#include <vector>
namespace living_field {
struct ParticleSettings { Vec3 gravity{}; double max_speed{5}; bool particle_feedback{false}; };
void step_particles(std::vector<ResponsiveParticle>& particles,const std::vector<MagneticNode>& nodes,double dt,const ParticleSettings& settings={});
std::vector<MagneticNode> approximate_particle_sources(const std::vector<ResponsiveParticle>& particles,std::uint32_t id_base=100000);
}

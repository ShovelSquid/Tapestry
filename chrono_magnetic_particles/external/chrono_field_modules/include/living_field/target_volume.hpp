#pragma once
#include "types.hpp"
#include <span>
namespace living_field {
double gaussian_density(Vec3 point,std::span<const Vec3> centers,double sigma);
ShapeGoal make_bridge_goal(Vec3 a,Vec3 b,int samples,double radius);
double score_density_goal(const ShapeGoal& goal,std::span<const ResponsiveParticle> particles,double kernel_radius);
}

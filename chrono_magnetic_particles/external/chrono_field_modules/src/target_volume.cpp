#include "living_field/target_volume.hpp"
namespace living_field {
double gaussian_density(Vec3 p,std::span<const Vec3> cs,double s){double sum=0,inv=1/(2*s*s);for(auto c:cs)sum+=std::exp(-length2(p-c)*inv);return sum;}
ShapeGoal make_bridge_goal(Vec3 a,Vec3 b,int n,double){ShapeGoal g;g.name="bridge";for(int i=0;i<n;++i){double t=n>1?double(i)/(n-1):0;g.sample_points.push_back(a*(1-t)+b*t);g.target_density.push_back(1);}return g;}
double score_density_goal(const ShapeGoal&g,std::span<const ResponsiveParticle> ps,double r){std::vector<Vec3> c;for(auto&p:ps)c.push_back(p.position);double err=0;for(size_t i=0;i<g.sample_points.size();++i){double d=gaussian_density(g.sample_points[i],c,r);double e=d-g.target_density[i];err+=e*e;}return g.sample_points.empty()?0:err/g.sample_points.size();}
}

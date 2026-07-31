#include "living_field/field_sampler.hpp"
namespace living_field {
std::vector<FieldSample> sample_volume(const std::vector<MagneticNode>& ns,const GridSpec&g){std::vector<FieldSample> out;out.reserve(g.nx*g.ny*g.nz);for(int z=0;z<g.nz;++z)for(int y=0;y<g.ny;++y)for(int x=0;x<g.nx;++x){Vec3 q{g.nx>1?double(x)/(g.nx-1):0,g.ny>1?double(y)/(g.ny-1):0,g.nz>1?double(z)/(g.nz-1):0};Vec3 p{g.min.x+(g.max.x-g.min.x)*q.x,g.min.y+(g.max.y-g.min.y)*q.y,g.min.z+(g.max.z-g.min.z)*q.z};out.push_back({p,DipoleField::combined_field(ns,p)});}return out;}
}

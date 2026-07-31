#pragma once
#include <algorithm>
#include <cmath>
namespace living_field {
constexpr double pi=3.14159265358979323846;
struct Vec3 { double x{},y{},z{};
  constexpr Vec3 operator+(Vec3 b)const{return{x+b.x,y+b.y,z+b.z};}
  constexpr Vec3 operator-(Vec3 b)const{return{x-b.x,y-b.y,z-b.z};}
  constexpr Vec3 operator-()const{return{-x,-y,-z};}
  constexpr Vec3 operator*(double s)const{return{x*s,y*s,z*s};}
  constexpr Vec3 operator/(double s)const{return{x/s,y/s,z/s};}
  Vec3& operator+=(Vec3 b){x+=b.x;y+=b.y;z+=b.z;return *this;}
  Vec3& operator-=(Vec3 b){x-=b.x;y-=b.y;z-=b.z;return *this;}
  Vec3& operator*=(double s){x*=s;y*=s;z*=s;return *this;}
};
inline Vec3 operator*(double s,Vec3 v){return v*s;}
inline double dot(Vec3 a,Vec3 b){return a.x*b.x+a.y*b.y+a.z*b.z;}
inline Vec3 cross(Vec3 a,Vec3 b){return{a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x};}
inline double length2(Vec3 v){return dot(v,v);} inline double length(Vec3 v){return std::sqrt(length2(v));}
inline Vec3 normalized(Vec3 v,Vec3 fallback={0,0,1}){double l=length(v);return l>1e-12?v/l:fallback;}
inline Vec3 clamp_length(Vec3 v,double max_l){double l=length(v);return l>max_l?v*(max_l/l):v;}
inline Vec3 rotate_axis_angle(Vec3 v,Vec3 axis,double radians){axis=normalized(axis); double c=std::cos(radians),s=std::sin(radians); return v*c+cross(axis,v)*s+axis*dot(axis,v)*(1-c);}
}

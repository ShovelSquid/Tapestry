#include "living_field/spin_controller.hpp"
#include <iostream>
using namespace living_field;int main(){MagneticNode n;n.drive.axis={0,1,0};n.drive.frequency_hz=5;for(int i=0;i<=10;++i){double t=i*.02;SpinController::apply(n,t,.02);std::cout<<t<<" s axis "<<n.magnetic_axis.x<<' '<<n.magnetic_axis.y<<' '<<n.magnetic_axis.z<<"\n";}std::cout<<"5 Hz = "<<SpinController::rpm(5)<<" RPM\n";}

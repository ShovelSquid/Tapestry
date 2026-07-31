#include "living_field/command_protocol.hpp"
#include <iostream>
using namespace living_field;int main(){for(auto s:{"frequency 2 8.5","axis 2 0 1 0","solve","bad command"}){std::string e;auto c=parse_command(s,&e);std::cout<<s<<" -> "<<(c?"ok":e)<<"\n";}}

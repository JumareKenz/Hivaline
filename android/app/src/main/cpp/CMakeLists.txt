# CMakeLists.txt — Build llama.cpp + JNI bridge for Edge Brain
#
# Builds two libraries:
#   1. libllama.so — the llama.cpp inference library
#   2. libedgebrain_jni.so — the JNI bridge that wraps llama.cpp
#
# This requires the llama.cpp source to be present at
# android/app/src/main/cpp/llama.cpp/ (as a git submodule or manual copy).

cmake_minimum_required(VERSION 3.22.1)
project(edgebrain)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Enable ARM optimizations for faster inference
if(ANDROID_ABI MATCHES "arm64-v8a")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -march=armv8.2-a+dotprod+i8mm")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -march=armv8.2-a+dotprod+i8mm")
endif()

# Disable GPU backends — CPU-only for mobile
set(GGML_CUDA OFF CACHE BOOL "" FORCE)
set(GGML_METAL OFF CACHE BOOL "" FORCE)
set(GGML_VULKAN OFF CACHE BOOL "" FORCE)
set(GGML_OPENCL OFF CACHE BOOL "" FORCE)

# Build llama.cpp as a static library
add_subdirectory(llama.cpp)

# JNI bridge library
add_library(edgebrain_jni SHARED edgebrain_jni.cpp)

target_include_directories(edgebrain_jni PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/include
    ${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/common
)

target_link_libraries(edgebrain_jni
    llama
    common
    log
    android
)

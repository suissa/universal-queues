import React, { useState, useEffect, useCallback, useMemo } from 'react'

const ChevronLeftIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 18-6-6 6-6" />
  </svg>
)

const ChevronRightIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6" />
  </svg>
)

const PlayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3"></polygon>
  </svg>
)

const PauseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="4" width="4" height="16"></rect>
    <rect x="14" y="4" width="4" height="16"></rect>
  </svg>
)

const sampleItems = [
  { id: 1, title: 'Elemento 1', content: 'Primeiro item.', bgColor: 'bg-indigo-500' },
  { id: 2, title: 'Elemento 2', content: 'Segundo item.', bgColor: 'bg-teal-500' },
  { id: 3, title: 'Elemento 3', content: 'Terceiro item.', bgColor: 'bg-rose-500' },
  { id: 4, title: 'Elemento 4', content: 'Quarto item.', bgColor: 'bg-amber-500' },
  { id: 5, title: 'Elemento 5', content: 'Quinto item.', bgColor: 'bg-sky-500' },
  { id: 6, title: 'Elemento 6', content: 'Sexto item.', bgColor: 'bg-purple-500' },
  { id: 7, title: 'Elemento 7', content: 'Sétimo item.', bgColor: 'bg-emerald-500' },
  { id: 8, title: 'Elemento 8', content: 'Oitavo item.', bgColor: 'bg-pink-500' },
]

const hoverEffects = {
  none: '',
  scaleUp: 'scale-105',
  liftUp: 'scale-105 -translate-y-2',
  shadow: 'shadow-2xl shadow-black/50',
  glow: 'shadow-[0_0_15px_5px] shadow-indigo-400/50',
}

const animations = {
  fade: {
    autoplay: true,
    delay: 3000,
    hover: 'scaleUp',
    selected: {
      animation: 'ring-4 ring-white scale-105',
      isSticky: true,
      onClick: (item) => console.log(`Item selecionado: ${item.title}`),
    },
    transition: {
      out: 'opacity-0',
      in: 'opacity-100',
      initial: 'opacity-0',
    },
  },
  slideDynamic: {
    autoplay: true,
    delay: 3000,
    hover: 'liftUp',
    selected: {
      animation: 'ring-4 ring-white scale-105',
      isSticky: true,
      onClick: (item) => console.log(`Item selecionado: ${item.title}`),
    },
    transition: {
      next: { out: 'opacity-0 -translate-x-full', in: 'opacity-100 translate-x-0', initial: 'opacity-0 -translate-x-full' },
      prev: { out: 'opacity-0 translate-x-full', in: 'opacity-100 translate-x-0', initial: 'opacity-0 translate-x-full' },
    },
  },
  slideClassic: {
    autoplay: true,
    delay: 3000,
    hover: 'liftUp',
    selected: {
      animation: 'ring-4 ring-white scale-105',
      isSticky: true,
      onClick: (item) => console.log(`Item selecionado: ${item.title}`),
    },
    transition: {
      next: { out: 'opacity-0 -translate-x-full', in: 'opacity-100 translate-x-0', initial: 'opacity-0 translate-x-full' },
      prev: { out: 'opacity-0 translate-x-full', in: 'opacity-100 translate-x-0', initial: 'opacity-0 -translate-x-full' },
    },
  },
  slideUpDown: {
    autoplay: true,
    delay: 3500,
    hover: 'scaleUp',
    selected: {
      animation: 'ring-4 ring-white scale-105',
      isSticky: false,
      onClick: (item) => console.log(`Item selecionado: ${item.title}`),
    },
    transition: {
      out: 'opacity-0 -translate-y-full',
      in: 'opacity-100 translate-y-0',
      initial: 'opacity-0 -translate-y-full',
    },
  },
  slideDownUp: {
    autoplay: true,
    delay: 3500,
    hover: 'scaleUp',
    selected: {
      animation: 'ring-4 ring-white scale-105',
      isSticky: false,
      onClick: (item) => console.log(`Item selecionado: ${item.title}`),
    },
    transition: {
      out: 'opacity-0 translate-y-full',
      in: 'opacity-100 translate-y-0',
      initial: 'opacity-0 translate-y-full',
    },
  },
  zoom: {
    autoplay: true,
    delay: 3000,
    hover: 'glow',
    selected: {
      animation: 'ring-4 ring-white scale-110',
      isSticky: true,
      onClick: (item) => console.log(`Item selecionado: ${item.title}`),
    },
    transition: {
      out: 'opacity-0 scale-90',
      in: 'opacity-100 scale-100',
      initial: 'opacity-0 scale-90',
    },
  },
  scaleInOut: {
    autoplay: true,
    delay: 4000,
    hover: 'shadow',
    selected: {
      animation: 'ring-4 ring-white',
      isSticky: false,
      onClick: (item) => console.log(`Item selecionado: ${item.title}`),
    },
    transition: {
      out: 'opacity-0 scale-150',
      in: 'opacity-100 scale-100',
      initial: 'opacity-0 scale-150',
    },
  },
  inverse: {
    autoplay: false,
    delay: 3000,
    hover: 'scaleUp',
    selected: {
      animation: 'ring-4 ring-white scale-105',
      isSticky: true,
      onClick: (item) => console.log(`Item selecionado: ${item.title}`),
    },
    transition: {
      out: 'opacity-0 scale-50 blur-lg -translate-z-[300px]',
      in: 'opacity-100 scale-100 blur-0 translate-z-0',
      initial: 'opacity-0 scale-50 blur-lg -translate-z-[300px]',
    },
  },
  whirlpool: {
    autoplay: true,
    delay: 4000,
    hover: 'glow',
    selected: {
      animation: 'ring-4 ring-white scale-105',
      isSticky: false,
      onClick: (item) => console.log(`Item selecionado: ${item.title}`),
    },
    transition: {
      out: 'opacity-0 scale-0 rotate-[-180deg]',
      in: 'opacity-100 scale-100 rotate-0',
      initial: 'opacity-0 scale-0 rotate-[180deg]',
    },
  },
}

const CarouselCard = ({ item, isSelected, isHovered, animationConfig }) => {
  const hoverClasses = isHovered ? hoverEffects[animationConfig.hover] || '' : ''
  const selectedClasses = isSelected ? animationConfig.selected.animation : ''

  return (
    <div className={`w-full h-64 ${item.bgColor} rounded-lg shadow-lg flex flex-col justify-center items-center p-6 text-white text-center transition-all duration-300 ease-in-out ${hoverClasses} ${selectedClasses}`}>
      <h3 className="text-2xl font-bold mb-2">{item.title}</h3>
      <p className="text-base">{item.content}</p>
    </div>
  )
}

export default function App() {
  const [items] = useState(sampleItems)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [animation, setAnimation] = useState('whirlpool')
  const [animationPhase, setAnimationPhase] = useState('in')
  const [direction, setDirection] = useState('next')
  const [isPlaying, setIsPlaying] = useState(true)
  const [isHovering, setIsHovering] = useState(false)
  const [hoveredIndex, setHoveredIndex] = useState(null)
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [itemsPerPage, setItemsPerPage] = useState(1)

  const animationConfig = useMemo(() => animations[animation], [animation])

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setItemsPerPage(3)
      } else if (window.innerWidth >= 768) {
        setItemsPerPage(2)
      } else {
        setItemsPerPage(1)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const totalPages = Math.ceil(items.length / itemsPerPage)

  useEffect(() => {
    if (currentIndex >= totalPages) {
      setCurrentIndex(totalPages - 1)
    }
  }, [totalPages, currentIndex])

  const isStickyActive = selectedIndex !== null && animationConfig.selected.isSticky && itemsPerPage > 1

  const handleNavigation = useCallback(
    (directionOrIndex) => {
      if (isStickyActive) return

      const newDirection =
        typeof directionOrIndex === 'string' ? directionOrIndex : directionOrIndex > currentIndex ? 'next' : 'prev'
      setDirection(newDirection)
      setAnimationPhase('out')

      setTimeout(() => {
        setAnimationPhase('initial')
        setCurrentIndex((prevIndex) => {
          if (typeof directionOrIndex === 'number') return directionOrIndex
          const newIndex = newDirection === 'next' ? prevIndex + 1 : prevIndex - 1
          if (newIndex >= totalPages) return 0
          if (newIndex < 0) return totalPages - 1
          return newIndex
        })
        setTimeout(() => {
          setAnimationPhase('in')
        }, 20)
      }, 500)
    },
    [totalPages, currentIndex, isStickyActive],
  )

  useEffect(() => {
    if (isPlaying && !isHovering && animationConfig.autoplay && !isStickyActive) {
      const timer = setInterval(() => handleNavigation('next'), animationConfig.delay)
      return () => clearInterval(timer)
    }
  }, [currentIndex, isPlaying, isHovering, animationConfig, handleNavigation, isStickyActive])

  const handleItemClick = (item, index) => {
    animationConfig.selected.onClick(item)
    setSelectedIndex((prev) => (prev === index ? null : index))
  }

  const currentTransitionConfig = animationConfig.transition.next
    ? animationConfig.transition[direction]
    : animationConfig.transition

  const startIndex = currentIndex * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const visibleItems = items.slice(startIndex, endIndex)

  const animationClasses =
    {
      in: currentTransitionConfig.in,
      out: currentTransitionConfig.out,
      initial: currentTransitionConfig.initial,
    }[animationPhase]

  return (
    <div className="bg-gray-900 min-h-screen flex flex-col items-center justify-center font-sans p-4 text-white">
      <div className="w-full max-w-5xl mx-auto flex flex-col space-y-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-2">Carrossel de Animações</h1>
          <p className="text-lg text-gray-400">Selecione, passe o rato, e redimensione a janela.</p>
        </div>

        <div className="flex justify-center">
          <select
            value={animation}
            onChange={(event) => setAnimation(event.target.value)}
            className="appearance-none bg-gray-800 border border-gray-700 text-white rounded-lg py-2 pl-4 pr-10 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            <option value="fade">Fade</option>
            <option value="slideDynamic">Slide Dinâmico</option>
            <option value="slideClassic">Slide Clássico</option>
            <option value="slideUpDown">Slide Cima/Baixo</option>
            <option value="slideDownUp">Slide Baixo/Cima</option>
            <option value="zoom">Zoom</option>
            <option value="scaleInOut">Scale In/Out</option>
            <option value="inverse">Inverse (3D)</option>
            <option value="whirlpool">Whirlpool</option>
          </select>
        </div>

        <div
          className="relative h-64 [perspective:1000px]"
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => {
            setIsHovering(false)
            setHoveredIndex(null)
          }}
        >
          <div
            key={currentIndex}
            className={`w-full h-full transition-all duration-500 ease-in-out [transform-style:preserve-3d] ${animationClasses}`}
          >
            <div className="flex gap-4 w-full h-full">
              {visibleItems.map((item, index) => {
                const globalIndex = startIndex + index
                return (
                  <div
                    key={item.id}
                    className="w-full h-full cursor-pointer"
                    onMouseEnter={() => setHoveredIndex(globalIndex)}
                    onClick={() => handleItemClick(item, globalIndex)}
                  >
                    <CarouselCard
                      item={item}
                      isSelected={selectedIndex === globalIndex}
                      isHovered={hoveredIndex === globalIndex}
                      animationConfig={animationConfig}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex justify-center items-center space-x-2 py-2">
          {Array.from({ length: totalPages }).map((_, index) => (
            <button
              key={index}
              onClick={() => handleNavigation(index)}
              className={`w-3 h-3 rounded-full transition-all ${
                currentIndex === index ? 'bg-indigo-500 scale-110' : 'bg-gray-600 hover:bg-gray-500'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={() => handleNavigation('prev')}
            disabled={isStickyActive}
            className="bg-gray-800 hover:bg-indigo-600 rounded-full p-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeftIcon />
          </button>
          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-400">
              <span>{currentIndex + 1}</span> / <span>{totalPages}</span>
            </div>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="bg-gray-800 hover:bg-indigo-600 rounded-full p-2 transition-colors"
            >
              {isPlaying && !isStickyActive ? <PauseIcon /> : <PlayIcon />}
            </button>
          </div>
          <button
            onClick={() => handleNavigation('next')}
            disabled={isStickyActive}
            className="bg-gray-800 hover:bg-indigo-600 rounded-full p-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>
    </div>
  )
}
